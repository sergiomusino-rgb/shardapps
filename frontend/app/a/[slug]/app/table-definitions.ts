/**
 * Definizioni delle tabelle per l'app gestionale figlia.
 *
 * Ogni tabella ha:
 * - Campi FISSI: colonne strutturali predefinite (es. Ragione Sociale, Nome Prodotto, Prezzo)
 * - dati_personalizzati (JSONB): colonne dinamiche aggiunte dall'utente finale
 */

// Import relativo (non l'alias "@/lib/...") apposta: table-definitions.ts è
// storicamente un modulo "nessuna dipendenza esterna" testabile con
// `node --test` diretto, senza il loader di risoluzione alias (vedi
// table-definitions.test.ts) — stessa estensione .ts esplicita richiesta
// dal resolver ESM nativo di Node per un import relativo di file .ts.
import { classifyFieldConcept, isFinancialConcept } from '../../../../lib/semantic-fields.ts';

export interface FieldDef {
  name: string;
  id?: string;
  label: string;
  type: 'text' | 'number' | 'email' | 'tel' | 'date' | 'datetime' | 'select' | 'multiselect'
    | 'textarea' | 'checkbox' | 'currency' | 'image' | 'file' | 'relation' | 'state';
  required?: boolean;
  options?: string[];
  /** Se true, questo campo non può essere rinominato o rimosso dall'utente */
  fixed?: boolean;
  /** Per campi di relazione (es. cliente_id → tabella clienti) */
  targetTable?: string;
  /** Campo label del record target (es. 'ragione_sociale') */
  targetLabel?: string;
  /** Per campi type:'state' (Fase 3): vocabolario completo degli stati ammessi. */
  states?: string[];
  /** Per campi type:'state': mappa {stato_partenza: [stati_arrivo_ammessi]} —
   * assente = tutte le transizioni tra `states` ammesse (vedi site-schema.ts). */
  allowedTransitions?: Record<string, string[]>;
}

/** Azione eseguibile su un record di un'entità (Fase 3), stesso vocabolario
 * chiuso di frontend/src/lib/site-schema.ts::EntityActionSchema — copiato qui
 * (non importato) perché table-definitions.ts è puramente client-side e non
 * deve tirarsi dietro Zod/il resto dello schema del motore Sito/PWA. */
export interface TableAction {
  id: string;
  label: string;
  type: 'change_state' | 'trigger_webhook' | 'send_notification';
  targetState?: string;
  requiredRole?: 'admin' | 'operator';
}

export interface TableDef {
  name: string;
  label: string;
  labelPlural: string;
  icon: string;
  fields: FieldDef[];
  /** Colore badge per la tabella */
  color?: string;
  /** Azioni disponibili sui record di questa tabella (Fase 3, facoltativo —
   * assente per le tabelle senza flusso di lavoro, la stragrande maggioranza). */
  actions?: TableAction[];
}

/**
 * Helper: restituisce il nome del campo
 */
export function fieldName(f: FieldDef): string {
  return f.name || f.id || '';
}

// Tabelle di sistema (iniettate sempre da blueprint-schema.ts) che nel menu
// laterale devono comparire in fondo, dopo le tabelle di lavoro del settore
// (Pazienti, Ordini, ...) e prima di Impostazioni/Logout.
const FATTURE_TABLE_NAMES = new Set(['fatture', 'documenti']);
// "Dati Azienda" non compare nella lista tabelle: è una voce a sé, mostrata
// appena sotto "Impostazioni" (vedi getDatiAziendaliTable).
const DATI_AZIENDALI_TABLE_NAMES = new Set(['dati_aziendali', 'impostazioni_azienda']);
const SYSTEM_TABLE_NAMES = new Set([...FATTURE_TABLE_NAMES, ...DATI_AZIENDALI_TABLE_NAMES]);

/**
 * Estrae la tabella "Dati Azienda" (se presente) dall'elenco tabelle, per
 * renderizzarla separatamente come voce fissa vicino a Impostazioni invece
 * che nella lista delle tabelle di lavoro.
 */
export function getDatiAziendaliTable<T extends { name: string }>(tables: T[]): T | undefined {
  return tables.find((t) => DATI_AZIENDALI_TABLE_NAMES.has(t.name));
}

/** True se la tabella ha un campo type:'state' (macchina a stati, Fase 4) —
 * per definizione l'entità con un flusso di lavoro operativo da far avanzare
 * (es. "opportunità"/"interventi"/"abbonamenti"), a differenza di
 * un'anagrafica pura (es. "clienti"/"agenti"). Stesso segnale semantico già
 * usato da selectQuickActionTables sotto, estratto qui perché ora lo
 * riusa anche sortTablesForSidebar (vedi CreatorAI V4, P1-6 sotto).
 */
function hasWorkflowState<T extends { fields: FieldDef[] }>(t: T): boolean {
  return t.fields.some((f) => f.type === 'state');
}

/**
 * Ordina le tabelle per la sidebar: "Fatture" viene spostata in fondo,
 * "Dati Azienda" viene rimossa dalla lista (renderizzata a parte vicino a
 * Impostazioni). Ordinamento stabile, solo per la visualizzazione — non
 * modifica l'array/i dati sottostanti.
 *
 * CreatorAI V4 (P1-6, benchmark post-hardening): prima le tabelle di lavoro
 * restavano nell'ordine grezzo di generazione del blueprint — per un CRM con
 * adminPanel.entities [aziende, opportunità] la sidebar (un contenitore con
 * scroll proprio, `nav` in ViewerSidebar.tsx/DynamicLayoutRenderer.tsx)
 * mostrava "Aziende Clienti" sopra "Opportunità di Vendita", l'entità
 * REALMENTE centrale (quella con un flusso di lavoro/stato da far avanzare)
 * — visibile solo scorrendo, non "raggiungibile solo da Dashboard" come
 * sembrava dal vivo, ma comunque meno prominente di un'anagrafica di
 * contorno. Stessa identica euristica già usata da selectQuickActionTables
 * (tabelle con `type:'state'` anteposte, ordine originale invariato a parità
 * di questo criterio): nessun nome di tabella hardcoded, funziona per
 * qualunque blueprint.
 */
export function sortTablesForSidebar<T extends { name: string; fields: FieldDef[] }>(tables: T[]): T[] {
  const work = tables.filter((t) => !SYSTEM_TABLE_NAMES.has(t.name));
  const workWithState = work.filter(hasWorkflowState);
  const workWithoutState = work.filter((t) => !hasWorkflowState(t));
  const system = tables.filter((t) => FATTURE_TABLE_NAMES.has(t.name));
  return [...workWithState, ...workWithoutState, ...system];
}

/**
 * Sceglie le tabelle da mostrare in "Azioni Rapide" nella Dashboard (Quality
 * Pass v1, Fix #4): prima era sempre `tables.slice(0, 4)`, l'ordine grezzo di
 * generazione del blueprint — per un CRM con adminPanel.entities
 * [attività, note, clienti, aziende, opportunità] l'entità realmente
 * centrale ("opportunità", quella con un flusso di lavoro/stato da far
 * avanzare) restava fuori dalle prime 4 e quindi invisibile in Azioni
 * Rapide, mentre entità anagrafiche/di contorno la precedevano solo per
 * ordine di dichiarazione nel prompt.
 *
 * Euristica: le tabelle con un campo `type:'state'` (macchina a stati,
 * site-schema.ts Fase 4) sono per definizione quelle con un flusso di
 * lavoro operativo — il caso d'uso tipico di un'azione rapida ("segna come
 * completato", "avanza lo stato") — quindi vengono anteposte; a parità di
 * questo criterio l'ordine originale (= ordine del blueprint) è preservato.
 * Le tabelle di sistema (fatture/dati aziendali) restano escluse, stesso
 * criterio già usato da sortTablesForSidebar — che (CreatorAI V4, P1-6)
 * applica ora la STESSA euristica (hasWorkflowState sopra) al proprio
 * ordinamento, per lo stesso motivo: l'elenco completo resta invariato,
 * cambia solo l'ordine con cui compare.
 */
export function selectQuickActionTables<T extends { name: string; fields: FieldDef[] }>(tables: T[], max = 4): T[] {
  const work = tables.filter((t) => !SYSTEM_TABLE_NAMES.has(t.name));
  const withState = work.filter(hasWorkflowState);
  const withoutState = work.filter((t) => !hasWorkflowState(t));
  return [...withState, ...withoutState].slice(0, max);
}

/**
 * Trova il campo prezzo "da mostrare al cliente" (es. prezzo di vendita)
 * distinguendolo da campi di costo interno (prezzo di acquisto): tabelle
 * come "prodotti" hanno spesso ENTRAMBI prezzo_acquisto e prezzo_vendita —
 * un semplice match su /prezzo/i sceglierebbe sempre il primo dei due
 * (di solito il costo d'acquisto, non il prezzo di vendita).
 *
 * CreatorAI V3: classificazione language-independent (classifyFieldConcept,
 * semantic-fields.ts) — prima riconosceva SOLO nomi campo italiani
 * (/vendita|totale|importo/, /prezzo|costo/), quindi un blueprint generato
 * in inglese ("price"/"total") non veniva mai riconosciuto come "il" campo
 * prezzo (issue GitHub #39, punto 1 — root cause del difetto osservato in
 * TEST E: il campo "price" non veniva escluso dal titolo/sottotitolo
 * identità perché findDisplayPriceField non lo riconosceva).
 */
export function findDisplayPriceField<T extends { name?: string; id?: string; type: string }>(fields: T[]): T | undefined {
  const currencyField = fields.find((f) => f.type === 'currency');
  if (currencyField) return currencyField;
  const numberFields = fields.filter((f) => f.type === 'number');
  // Nome del campo per il matching: T non estende nominalmente FieldDef (è
  // un generic strutturale più permissivo, per restare riusabile anche da
  // chiamanti con tipi propri) — un piccolo helper locale invece del cast
  // `as any` che il generic imported fieldName(FieldDef) richiederebbe qui.
  const nameOf = (f: T) => f.name || f.id || '';
  // "prezzo_acquisto"/"purchase_price": costo interno, mai il prezzo
  // mostrato al cliente — anche se il nome contiene comunque un concetto
  // finanziario riconosciuto.
  const isPurchaseCost = (f: T) => /acquist|purchase/i.test(nameOf(f));
  const conceptOf = (f: T) => classifyFieldConcept(nameOf(f));
  return numberFields.find((f) => !isPurchaseCost(f) && (conceptOf(f) === 'total_cost' || conceptOf(f) === 'unit_price'))
    || numberFields.find((f) => !isPurchaseCost(f) && isFinancialConcept(conceptOf(f)));
}

/**
 * Rimuove un eventuale campo di schema chiamato letteralmente "id" (es. da
 * un blueprint AI mal generato): collide concettualmente con l'id reale del
 * record (colonna primaria, gestita a parte — vedi normalizzazione in
 * page.tsx) e mostrerebbe all'utente finale solo una stringa numerica
 * interna, senza alcun significato. Campo riservato: mai visibile né
 * modificabile dall'utente.
 */
export function stripReservedIdField(table: TableDef): TableDef {
  const filtered = table.fields.filter((f) => fieldName(f).toLowerCase() !== 'id');
  if (filtered.length === table.fields.length) return table;
  return { ...table, fields: filtered };
}

// ─── Dashboard KPI custom (Quality Pass v1, Fix #3) ─────────────────────────
// Calcola il valore di una dashboardCard (site-schema.ts/blueprint-schema.ts,
// stesso concetto riusato dai due motori) sui record REALMENTE scaricati
// dalla Dashboard — mai un dato inventato, coerente col principio "KPI reali"
// già seguito dalle 3 card generiche esistenti (Tabelle/Record Totali/Ultima
// Attività). Vive qui (non in page.tsx) perché è puro/senza JSX, testabile
// con `node --test` come selectQuickActionTables sopra.

/** Sottoinsieme del DashboardCard di blueprint-schema.ts effettivamente letto
 * qui — evita di dover importare Zod/il tipo completo in un modulo
 * puramente client-side senza dipendenze pesanti. */
export interface DashboardCardLike {
  type: string;
  table: string;
  label: string;
  field?: string;
  filter?: Record<string, unknown>;
}

/** Un record già "appiattito" (solo i valori dei campi, come vengono salvati
 * in record.data) più la data di creazione, usata solo dal type "latest". */
export interface DashboardCardRecord {
  data: Record<string, unknown>;
  createdAt?: string | null;
}

// Unica forma di filtro supportata oggi (vedi DASHBOARD_CARDS_DOC in
// creator-site-generator.ts): {"campo": {"in": ["valore1", "valore2"]}}.
// Una condizione non riconosciuta (formato diverso da quello documentato)
// NON filtra — fail-open, mai una card che sparisce per un JSON malformato
// che l'AI può comunque generare.
function matchesCardFilter(record: Record<string, unknown>, filter?: Record<string, unknown>): boolean {
  if (!filter) return true;
  return Object.entries(filter).every(([field, cond]) => {
    if (cond && typeof cond === 'object' && Array.isArray((cond as { in?: unknown }).in)) {
      return (cond as { in: unknown[] }).in.includes(record[field]);
    }
    return true;
  });
}

/** Restituisce il valore da mostrare sulla card, già formattato come stringa. */
export function computeDashboardCardValue(card: DashboardCardLike, records: DashboardCardRecord[]): string {
  const matched = records.filter((r) => matchesCardFilter(r.data, card.filter));
  switch (card.type) {
    case 'sum': {
      const sum = matched.reduce((acc, r) => acc + (Number(r.data[card.field || '']) || 0), 0);
      return String(sum);
    }
    case 'avg': {
      if (matched.length === 0) return '0';
      const sum = matched.reduce((acc, r) => acc + (Number(r.data[card.field || '']) || 0), 0);
      const avg = sum / matched.length;
      return Number.isInteger(avg) ? String(avg) : avg.toFixed(1);
    }
    case 'latest': {
      if (matched.length === 0) return '—';
      const sorted = [...matched].sort(
        (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
      );
      const v = card.field ? sorted[0].data[card.field] : undefined;
      return v != null && v !== '' ? String(v) : '—';
    }
    case 'count':
    default:
      return String(matched.length);
  }
}

// ─── Fix blocker CRUD custom entities (production, app "Lumen CRM") ────────
// EcommerceLayoutContent (DynamicLayoutRenderer.tsx, layout dedicato al
// design "marketnest") mostrava sulla dashboard 3 card KPI hardcoded
// "Prodotti"/"Ordini"/"Clienti" — corrette SOLO per un'app che ha
// letteralmente tabelle con questi 3 nomi esatti, un valore fisso (spesso 0)
// per qualsiasi altra entità custom (es. un CRM con tabelle
// opportunita/attivita/aziende, dirottato su questo layout da un falso
// positivo nel matching del settore — vedi designTokens.ts). Stessa causa
// radice del bug "griglia menu ristorante" sopra (isRestaurantMenuGridTable):
// un layout di settore che assume una forma fissa dello schema invece di
// leggere le entità REALI dell'app. Fix generico: le stesse 2 card
// "Sezioni attive"/"Record Totali" già usate (in modo corretto, schema-driven)
// da DocsLayoutContent e SaaSLayoutContent nello stesso file — nessuna nuova
// logica, solo la stessa già testata dal vivo, ora condivisa anche da
// EcommerceLayoutContent. Pura/senza JSX, testabile con `node --test`.
export function getGenericSectionKpis(
  tables: Pick<TableDef, 'name'>[],
  totalRecords: number
): { title: string; value: string }[] {
  return [
    { title: 'Sezioni attive', value: String(tables.length) },
    { title: 'Record Totali', value: String(totalRecords) },
  ];
}

// ─── Fix blocker TEST D (debug V3, app "ristorazione") ─────────────────────
// RestaurantLayoutContent (DynamicLayoutRenderer.tsx, layout dedicato al
// settore "ristorazione", PRE-ESISTENTE — non toccato dall'evoluzione
// CreatorAI v2/v3) ha una griglia "menu" hardcoded pensata per UNA SOLA
// tabella, "piatti" — per qualunque altra tabella del blueprint (clienti,
// ordini, righe_ordine...) tentava comunque di renderizzarla come card-piatto
// (leggendo campi tipo "categoria"/"descrizione"/"prezzo" che quelle tabelle
// non hanno), risultando in una griglia vuota SENZA alcuna azione disponibile
// (né "Nuovo", né un messaggio "nessun record") — bug riprodotto in
// produzione su un'app "Trattoria da Marco" con uno schema legittimo a
// più tabelle (piatti/clienti/ordini/righe_ordine), non causato da CreatorAI
// v3 (mai toccato il file), ma esposto da un blueprint realistico. Questa
// funzione pura isola la decisione ("questa tabella è quella per cui la
// griglia menu ha senso?") perché sia verificabile con `node --test` — il
// file .tsx che la usa contiene JSX, non eseguibile direttamente da Node.
export function isRestaurantMenuGridTable(tableName: string | undefined | null): boolean {
  return tableName === 'piatti';
}

/**
 * Garantisce che una tabella abbia un campo Immagine, senza richiedere che
 * l'utente lo aggiunga a mano da "Modifica Tabella": ogni nuovo record deve
 * poter avere una foto propria fin da subito, non solo le tabelle
 * configurate esplicitamente. Non tocca tabelle che hanno già un campo
 * immagine (es. nome diverso da 'immagine', scelto dal blueprint AI).
 */
export function ensureImageField(table: TableDef): TableDef {
  if (table.fields.some((f) => f.type === 'image')) return table;
  return {
    ...table,
    fields: [
      ...table.fields,
      { name: 'immagine', id: 'immagine', label: 'Immagine', type: 'image' },
    ],
  };
}

/**
 * Individua i campi "identità" di una tabella (immagine, titolo, badge,
 * prezzo, sottotitoli): stessa selezione usata dalla vista a card
 * (RecordCardGrid) e dalla colonna miniatura+nome della vista a tabella
 * piatta (DynamicDataTable), così una riga si presenta allo stesso modo
 * in entrambe le viste.
 */
export function pickIdentityFields<T extends FieldDef>(fields: T[]): {
  imageField: T | undefined;
  titleField: T | undefined;
  badgeField: T | undefined;
  priceField: T | undefined;
  subtitleFields: T[];
} {
  const imageField = fields.find((f) => f.type === 'image');
  const badgeField = fields.find((f) => f.type === 'select');
  const priceField = findDisplayPriceField(fields);
  const eligible = (f: T) => f !== badgeField && f !== imageField;
  // CreatorAI V3 (fix TEST E — issue GitHub #39, punto 3): il fallback
  // "fields[0]" da solo poteva scegliere un campo relation/number/date/state
  // come titolo — mostrato poi come valore GREZZO invece che tramite
  // resolveRelationLabel (es. la colonna "Member" di un abbonamento
  // mostrava, di fatto, il campo "price" adiacente perché il titolo
  // relation non risolto risultava vuoto). Qui si sceglie in ordine di
  // preferenza un campo "nominabile": testo, poi email, poi relation (ora
  // risolta correttamente a valle da DynamicDataTable.tsx/
  // RecordCardGrid.tsx), infine qualunque tipo che NON sia palesemente
  // inadatto come titolo (numero/valuta/data/stato) — fields[0] resta
  // l'ultima risorsa, invariato quando non c'è alcuna alternativa migliore.
  const titleField = fields.find((f) => f.type === 'text' && eligible(f))
    || fields.find((f) => f.type === 'email' && eligible(f))
    || fields.find((f) => f.type === 'relation' && eligible(f))
    || fields.find((f) => !['number', 'currency', 'date', 'datetime', 'state'].includes(f.type) && eligible(f))
    || fields[0];
  const subtitleFields = fields
    .filter((f) => f !== titleField && f !== badgeField && f !== priceField && f !== imageField)
    .slice(0, 2);
  return { imageField, titleField, badgeField, priceField, subtitleFields };
}

/**
 * Helper: estrae le chiavi uniche da dati_personalizzati su tutti i record
 */
export function extractDynamicKeys(
  records: Array<{ dati_personalizzati?: Record<string, unknown> }>
): string[] {
  const keys = new Set<string>();
  records.forEach((r) => {
    if (r.dati_personalizzati) {
      Object.keys(r.dati_personalizzati).forEach((k) => keys.add(k));
    }
  });
  return Array.from(keys).sort();
}

/**
 * Helper: unisce campi fissi + colonne dinamiche per la vista tabella
 */
export function getDisplayFields(
  table: TableDef,
  dynamicKeys: string[]
): Array<{ key: string; label: string; type: string; dynamic: boolean }> {
  const fixed = table.fields.map((f) => ({
    key: fieldName(f),
    label: f.label,
    type: f.type,
    dynamic: false,
  }));
  const dynamic = dynamicKeys.map((k) => ({
    key: `dati_personalizzati.${k}`,
    label: k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' '),
    type: 'text',
    dynamic: true,
  }));
  return [...fixed, ...dynamic];
}

/**
 * Helper: legge un valore da un record, cercando sia nei campi fissi che in dati_personalizzati
 */
export function getRecordValue(
  record: Record<string, unknown>,
  fieldKey: string
): unknown {
  if (fieldKey.startsWith('dati_personalizzati.')) {
    const k = fieldKey.replace('dati_personalizzati.', '');
    const dp = (record.dati_personalizzati as Record<string, unknown>) || {};
    return dp[k] ?? '';
  }
  return record[fieldKey] ?? '';
}

// ─── TABELLA 1: CLIENTI ──────────────────────────────────────────────────────────

export const CLIENTI_TABLE: TableDef = {
  name: 'clienti',
  label: 'Cliente',
  labelPlural: 'Clienti',
  icon: 'users',
  color: '#6366f1',
  fields: [
    {
      name: 'id',
      label: 'ID',
      type: 'text',
      fixed: true,
    },
    {
      name: 'ragione_sociale',
      label: 'Ragione Sociale',
      type: 'text',
      required: true,
      fixed: true,
    },
    {
      name: 'partita_iva',
      label: 'Partita IVA',
      type: 'text',
      fixed: true,
    },
    {
      name: 'email',
      label: 'Email',
      type: 'email',
      fixed: true,
    },
    {
      name: 'telefono',
      label: 'Telefono',
      type: 'tel',
      fixed: true,
    },
    {
      name: 'indirizzo',
      label: 'Indirizzo',
      type: 'text',
      fixed: true,
    },
    {
      name: 'citta',
      label: 'Città',
      type: 'text',
      fixed: true,
    },
    {
      name: 'cap',
      label: 'CAP',
      type: 'text',
      fixed: true,
    },
    {
      name: 'note',
      label: 'Note',
      type: 'textarea',
      fixed: true,
    },
  ],
};

// ─── TABELLA 2: PRODOTTI / CATALOGO ──────────────────────────────────────────────

export const PRODOTTI_TABLE: TableDef = {
  name: 'prodotti',
  label: 'Prodotto',
  labelPlural: 'Prodotti',
  icon: 'products',
  color: '#22c55e',
  fields: [
    {
      name: 'id',
      label: 'ID',
      type: 'text',
      fixed: true,
    },
    {
      name: 'nome_prodotto',
      label: 'Nome Prodotto',
      type: 'text',
      required: true,
      fixed: true,
    },
    {
      name: 'codice_articolo',
      label: 'Codice Articolo',
      type: 'text',
      fixed: true,
    },
    {
      name: 'prezzo',
      label: 'Prezzo (€)',
      type: 'number',
      required: true,
      fixed: true,
    },
    {
      name: 'categoria',
      label: 'Categoria',
      type: 'select',
      options: ['Merce', 'Servizio', 'Digitale', 'Altro'],
      fixed: true,
    },
    {
      name: 'unita_misura',
      label: 'Unità di Misura',
      type: 'select',
      options: ['pezzi', 'kg', 'litri', 'metri', 'ore'],
      fixed: true,
    },
    {
      name: 'iva',
      label: 'Aliquota IVA (%)',
      type: 'select',
      options: ['4', '5', '10', '22'],
      fixed: true,
    },
    {
      name: 'descrizione',
      label: 'Descrizione',
      type: 'textarea',
      fixed: true,
    },
    {
      name: 'immagine_url',
      label: 'URL Immagine',
      type: 'text',
      fixed: true,
    },
  ],
};

// ─── TABELLA 3: ORDINI (con relazioni a Clienti e Prodotti) ──────────────────────

export const ORDINI_TABLE: TableDef = {
  name: 'ordini',
  label: 'Ordine',
  labelPlural: 'Ordini',
  icon: 'orders',
  color: '#f59e0b',
  fields: [
    {
      name: 'id',
      label: 'ID',
      type: 'text',
      fixed: true,
    },
    {
      name: 'numero_ordine',
      label: 'N. Ordine',
      type: 'text',
      required: true,
      fixed: true,
    },
    {
      name: 'cliente_id',
      label: 'Cliente',
      type: 'select',
      required: true,
      fixed: true,
      targetTable: 'clienti',
      targetLabel: 'ragione_sociale',
    },
    {
      name: 'prodotto_id',
      label: 'Prodotto',
      type: 'select',
      required: true,
      fixed: true,
      targetTable: 'prodotti',
      targetLabel: 'nome_prodotto',
    },
    {
      name: 'quantita',
      label: 'Quantità',
      type: 'number',
      required: true,
      fixed: true,
    },
    {
      name: 'prezzo_unitario',
      label: 'Prezzo Unitario (€)',
      type: 'number',
      required: true,
      fixed: true,
    },
    {
      name: 'totale',
      label: 'Totale (€)',
      type: 'number',
      fixed: true,
    },
    {
      name: 'stato',
      label: 'Stato',
      type: 'select',
      options: ['Nuovo', 'In Lavorazione', 'Completato', 'Fatturato', 'Annullato'],
      fixed: true,
    },
    {
      name: 'data_ordine',
      label: 'Data Ordine',
      type: 'date',
      fixed: true,
    },
    {
      name: 'data_consegna',
      label: 'Data Consegna Prevista',
      type: 'date',
      fixed: true,
    },
    {
      name: 'note',
      label: 'Note',
      type: 'textarea',
      fixed: true,
    },
  ],
};

// ─── TABELLA 4: MAGAZZINO / SPEDIZIONI (collegata a Ordini) ─────────────────────

export const MAGAZZINO_TABLE: TableDef = {
  name: 'magazzino',
  label: 'Spedizione',
  labelPlural: 'Magazzino',
  icon: 'default',
  color: '#06b6d4',
  fields: [
    {
      name: 'id',
      label: 'ID',
      type: 'text',
      fixed: true,
    },
    {
      name: 'ordine_id',
      label: 'Ordine Collegato',
      type: 'select',
      required: true,
      fixed: true,
      targetTable: 'ordini',
      targetLabel: 'numero_ordine',
    },
    {
      name: 'stato_preparazione',
      label: 'Stato Preparazione',
      type: 'select',
      options: ['In Attesa', 'In Preparazione', 'Pronto', 'Spedito', 'Consegnato'],
      required: true,
      fixed: true,
    },
    {
      name: 'data_preparazione',
      label: 'Data Inizio Prep.',
      type: 'date',
      fixed: true,
    },
    {
      name: 'data_spedizione',
      label: 'Data Spedizione',
      type: 'date',
      fixed: true,
    },
    {
      name: 'corriere',
      label: 'Corriere',
      type: 'select',
      options: ['BRT', 'SDA', 'DHL', 'FedEx', 'TNT', 'GLS', 'Nessuno'],
      fixed: true,
    },
    {
      name: 'numero_tracking',
      label: 'N. Tracking',
      type: 'text',
      fixed: true,
    },
    {
      name: 'note_logistica',
      label: 'Note Logistica',
      type: 'textarea',
      fixed: true,
    },
  ],
};

// ─── LISTA COMPLETA DEL SISTEMA ────────────────────────────────────────────────────

export const SYSTEM_TABLES: TableDef[] = [
  CLIENTI_TABLE,
  PRODOTTI_TABLE,
  ORDINI_TABLE,
  MAGAZZINO_TABLE,
];

/**
 * Ottiene una tabella per nome
 */
export function getTableByName(name: string): TableDef | undefined {
  return SYSTEM_TABLES.find((t) => t.name === name);
}

/**
 * Restituisce i campi fissi di una tabella (escludendo quelli marcati come non fissi)
 */
export function getFixedFields(table: TableDef): FieldDef[] {
  return table.fields.filter((f) => f.fixed !== false);
}

/**
 * Genera un record vuoto per una tabella con valori di default
 */
export function createEmptyRecord(tableName: string): Record<string, unknown> {
  const table = getTableByName(tableName);
  if (!table) return {};

  const record: Record<string, unknown> = {};
  table.fields.forEach((f) => {
    switch (f.type) {
      case 'number':
        record[fieldName(f)] = 0;
        break;
      case 'checkbox':
        record[fieldName(f)] = false;
        break;
      case 'date':
        record[fieldName(f)] = new Date().toISOString().split('T')[0];
        break;
      default:
        record[fieldName(f)] = '';
    }
  });
  record.dati_personalizzati = {};
  return record;
}