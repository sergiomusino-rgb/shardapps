/**
 * Definizioni delle tabelle per l'app gestionale figlia.
 * 
 * Ogni tabella ha:
 * - Campi FISSI: colonne strutturali predefinite (es. Ragione Sociale, Nome Prodotto, Prezzo)
 * - dati_personalizzati (JSONB): colonne dinamiche aggiunte dall'utente finale
 */

export interface FieldDef {
  name: string;
  id?: string;
  label: string;
  type: 'text' | 'number' | 'email' | 'tel' | 'date' | 'datetime' | 'select' | 'multiselect'
    | 'textarea' | 'checkbox' | 'currency' | 'image' | 'file' | 'relation';
  required?: boolean;
  options?: string[];
  /** Se true, questo campo non può essere rinominato o rimosso dall'utente */
  fixed?: boolean;
  /** Per campi di relazione (es. cliente_id → tabella clienti) */
  targetTable?: string;
  /** Campo label del record target (es. 'ragione_sociale') */
  targetLabel?: string;
}

export interface TableDef {
  name: string;
  label: string;
  labelPlural: string;
  icon: string;
  fields: FieldDef[];
  /** Colore badge per la tabella */
  color?: string;
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

/**
 * Ordina le tabelle per la sidebar: le tabelle di lavoro restano in cima
 * nell'ordine originale, "Fatture" viene spostata in fondo, "Dati Azienda"
 * viene rimossa dalla lista (renderizzata a parte vicino a Impostazioni).
 * Ordinamento stabile, solo per la visualizzazione — non modifica l'array/i
 * dati sottostanti.
 */
export function sortTablesForSidebar<T extends { name: string }>(tables: T[]): T[] {
  const work = tables.filter((t) => !SYSTEM_TABLE_NAMES.has(t.name));
  const system = tables.filter((t) => FATTURE_TABLE_NAMES.has(t.name));
  return [...work, ...system];
}

/**
 * Trova il campo prezzo "da mostrare al cliente" (es. prezzo di vendita)
 * distinguendolo da campi di costo interno (prezzo di acquisto): tabelle
 * come "prodotti" hanno spesso ENTRAMBI prezzo_acquisto e prezzo_vendita —
 * un semplice match su /prezzo/i sceglierebbe sempre il primo dei due
 * (di solito il costo d'acquisto, non il prezzo di vendita).
 */
export function findDisplayPriceField<T extends { name?: string; id?: string; type: string }>(fields: T[]): T | undefined {
  return fields.find((f) => f.type === 'currency')
    || fields.find((f) => f.type === 'number' && /vendita|totale|importo/i.test(fieldName(f as any)))
    || fields.find((f) => f.type === 'number' && /prezzo|costo/i.test(fieldName(f as any)) && !/acquist/i.test(fieldName(f as any)));
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