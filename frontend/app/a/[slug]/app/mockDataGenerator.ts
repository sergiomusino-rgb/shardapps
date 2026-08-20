/**
 * Generatore di record di esempio, per popolare una tabella appena creata
 * (vuota) con dati plausibili invece di caselle vuote — stesso spirito
 * delle foto placeholder contestuali in recordPlaceholderImages.ts, ma per
 * il testo: euristiche sul nome/tipo di campo, nessuna chiamata AI (niente
 * costo, niente latenza, deterministico).
 *
 * CreatorAI V3: la classificazione del nome campo (person_name, unit_price,
 * date_start, ...) vive ora in @/lib/semantic-fields.ts — un livello
 * semantico CONDIVISO e language-independent (IT+EN), non più duplicato con
 * regex solo italiane qui dentro. Questo file resta responsabile SOLO della
 * "data strategy": quale generatore usare per un concetto dato, con quali
 * dipendenze fra campi dello stesso record (vedi FormulaContext/DateContext
 * sotto) — la classificazione stessa (field name -> concept) è delegata.
 */

// Estensione esplicita (stesso motivo/pattern di site-schema.ts,
// tsconfig.json::allowImportingTsExtensions): permette a questo modulo di
// essere eseguito anche direttamente da `node --test`
// (mockDataGenerator.test.ts, Quality Pass v1) — Next.js/webpack risolve un
// import relativo con o senza estensione .ts in modo identico, nessun
// cambio di comportamento a runtime nell'app. TableDef/FieldDef separati con
// `import type` (sono interface, nessun binding a runtime): il type-stripping
// nativo di `node --test` non elide da solo un named import type-only che
// non usa la keyword esplicita, a differenza del compilatore TS di Next.js.
import { fieldName } from './table-definitions.ts';
import type { TableDef, FieldDef } from './table-definitions.ts';
import { getPlaceholderCategoryForTable, type PlaceholderCategory } from '@/lib/recordPlaceholderImages';
import { classifyFieldConcept, type SemanticConcept } from '@/lib/semantic-fields';

const FIRST_NAMES = ['Marco', 'Giulia', 'Luca', 'Sara', 'Andrea', 'Chiara', 'Davide', 'Francesca', 'Matteo', 'Elena'];
const LAST_NAMES = ['Rossi', 'Bianchi', 'Verdi', 'Russo', 'Ferrari', 'Esposito', 'Romano', 'Colombo', 'Ricci', 'Marino'];
const COMPANY_NAMES = ['Edilizia Verdi', 'Autotrasporti Lombardi', 'Ferramenta Centrale', 'Officina Bianchi', 'Impianti Rossi', 'Logistica Meridionale', 'Costruzioni Moderne', 'Trasporti Veloci'];
const COMPANY_SUFFIXES = ['S.r.l.', 'S.n.c.', '& Figli S.n.c.', 'S.p.A.'];
const CITIES = ['Milano', 'Roma', 'Torino', 'Napoli', 'Bologna', 'Firenze', 'Bari', 'Padova', 'Verona', 'Genova'];
const STREETS = ['Via Roma', 'Via Garibaldi', 'Corso Italia', 'Via Dante', 'Viale Europa', 'Via Verdi', 'Piazza Duomo', 'Via Mazzini'];
const NOTES = [
  'Nessuna nota particolare.',
  'Da verificare al prossimo controllo.',
  'Cliente storico, sempre puntuale.',
  'Richiede conferma telefonica.',
  'Consegna prevista in settimana.',
];

const CATEGORY_TITLES: Record<PlaceholderCategory, string[]> = {
  veicoli: ['Volkswagen Passat Variant', 'Fiat 500', 'Peugeot 3008', 'Toyota Yaris Hybrid', 'BMW Serie 3 320d', 'Audi A4', 'Renault Clio', 'Ford Focus'],
  immobili: ['Appartamento Centro Storico', 'Villa con Giardino', 'Bilocale Zona Stazione', 'Attico Vista Mare', 'Loft Ristrutturato'],
  prodotti: ['Kit Ricambi Freni', 'Filtro Olio Motore', 'Batteria 12V 60Ah', 'Pneumatico Estivo 205/55', 'Cinghia Distribuzione'],
  piatti: ['Margherita', 'Carbonara', 'Tagliata di Manzo', 'Risotto ai Funghi', 'Tiramisù'],
  corsi: ['Corso Excel Avanzato', 'Corso di Fotografia', 'Corso Primo Soccorso', 'Corso Inglese B2', 'Corso Marketing Digitale'],
  eventi: ['Concerto Jazz', 'Fiera del Vino', 'Workshop Fotografico', "Mostra d'Arte Contemporanea", 'Sagra del Paese'],
  attrezzature: ['Trapano a Percussione', 'Generatore Elettrico', 'Betoniera Portatile', "Compressore d'Aria", 'Sega Circolare'],
  servizi: ['Manutenzione Ordinaria', 'Pulizia Professionale', 'Consulenza Fiscale', 'Assistenza Tecnica', 'Servizio di Trasporto'],
};
const GENERIC_TITLES = ['Elemento Alpha', 'Elemento Beta', 'Elemento Gamma', 'Elemento Delta', 'Elemento Epsilon'];

// ─── Pool generici per campi testuali "di dominio" senza categoria nota ─────
// (Quality Pass v1.1, Fix #1): prima OGNI campo testuale non riconosciuto da
// nessuna euristica sotto — es. "descrizione", "note", "titolo",
// "ore_lavorate" su un'entità come "lead"/"aziende"/"interventi" — ricadeva
// sullo stesso identity.categoryTitle condiviso dal record (bug residuo
// confermato dalla validazione reale del Quality Pass v1: due campi diversi
// sullo stesso record mostravano il medesimo placeholder). Questi pool,
// combinati con pickForField sotto, danno un valore diverso PER CAMPO e per
// RECORD, restando deterministico.
const GENERIC_DESCRIPTIONS = [
  'Attività gestita secondo la procedura standard, nessuna criticità rilevata.',
  'Richiede un aggiornamento periodico da parte del responsabile assegnato.',
  'Prima valutazione già completata, in attesa di conferma finale.',
  'Elemento monitorato con cadenza regolare dal team operativo.',
  'Dettagli raccolti direttamente in fase di apertura della pratica.',
];
const GENERIC_NOTES = [
  'Nessuna nota particolare al momento.',
  'Da ricontattare per un aggiornamento.',
  'Verificato, tutto in regola.',
  'In attesa di documentazione aggiuntiva.',
  'Priorità media, nessuna urgenza segnalata.',
];
const GENERIC_TITLES_FALLBACK = [
  'Pratica in lavorazione',
  'Richiesta standard',
  'Nuova voce registrata',
  'Aggiornamento recente',
  'Elemento da completare',
];

function pick<T>(arr: T[], index: number): T {
  return arr[((index % arr.length) + arr.length) % arr.length];
}

/** Hash deterministico e stabile di una stringa (somma pesata dei code
 * point, come tante implementazioni minimali di string-hash) — usato per far
 * dipendere la scelta/il valore anche dal nome del campo, non solo
 * dall'indice del record: è il meccanismo alla base del fix CreatorAI V3
 * (issue GitHub #39, punto 2) — OGNI campo semanticamente distinto (anche
 * quando resta "generico"/non riconosciuto) deve avere una propria
 * variazione, mai lo stesso seed fisso di un altro campo del record. */
function stringHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Come pick(), ma l'offset nel pool dipende ANCHE da tabella+campo (via
 * stringHash), non solo dall'indice del record — stesso identico
 * meccanismo deterministico "stesso input -> stesso output" già usato da
 * pick()/randomInt() in questo file, esteso con un secondo asse di
 * variazione. Due campi diversi sullo stesso record (stesso index) pescano
 * quindi voci diverse del pool; lo stesso campo su record diversi (stesso
 * tableName+fieldId, index diverso) pesca comunque voci diverse tra loro.
 */
function pickForField<T>(pool: T[], tableName: string, field: FieldDef, index: number): T {
  const offset = stringHash(`${tableName}:${fieldName(field)}`);
  return pick(pool, index + offset);
}

function randomInt(min: number, max: number, seed: number): number {
  // Variazione pseudo-casuale ma deterministica (stesso indice → stesso
  // valore): evita mock diversi ad ogni refresh accidentale del form.
  const x = Math.sin(seed * 999) * 10000;
  const frac = x - Math.floor(x);
  return min + Math.floor(frac * (max - min + 1));
}

/** Normalizza per il matching sul nome campo: minuscolo, senza accenti. */
function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function slugifyForEmail(s: string): string {
  return norm(s).replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
}

interface MockIdentity {
  firstName: string;
  lastName: string;
  fullName: string;
  companyName: string;
  city: string;
  street: string;
  categoryTitle: string;
  /** Quality Pass v1.1 (Fix #1): true solo se table.name è mappato a una
   * categoria REALE (veicoli/immobili/prodotti/...), non al pool generico
   * GENERIC_TITLES. Serve a distinguere, più a valle, i casi in cui
   * categoryTitle è un valore genuinamente specifico del dominio (da
   * preservare) da quelli in cui è solo il fallback condiviso "Elemento
   * Alpha/Beta/..." (da NON riusare più su più campi dello stesso record). */
  hasCategory: boolean;
}

function buildIdentity(table: TableDef, index: number): MockIdentity {
  const firstName = pick(FIRST_NAMES, index);
  const lastName = pick(LAST_NAMES, index + 1);
  const category = getPlaceholderCategoryForTable(table.name);
  const titlePool = category ? CATEGORY_TITLES[category] : GENERIC_TITLES;
  return {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    companyName: `${pick(COMPANY_NAMES, index)} ${pick(COMPANY_SUFFIXES, index)}`,
    city: pick(CITIES, index),
    street: `${pick(STREETS, index)}, ${1 + ((index * 7) % 90)}`,
    categoryTitle: pick(titlePool, index),
    hasCategory: Boolean(category),
  };
}

// ─── Numeri semantici (CreatorAI v2 Fix F.1 -> V3 esteso) ──────────────────
// v2 riconosceva solo ore/tariffa/costo_manodopera/costo_materiali/costo_totale
// (regex italiane) e usava un fallback CONDIVISO (stesso seed fisso) per
// qualunque altro campo non riconosciuto — bug osservato nel benchmark v2
// reale (issue #39, punto 2: "unit_price"/"subtotal", entrambi non
// riconosciuti da regex italiane, ricevevano lo STESSO valore identico su
// ogni record). V3 risolve entrambi i problemi alla radice:
// 1. la classificazione (classifyFieldConcept, semantic-fields.ts) è
//    language-independent: "unit_price"/"subtotal" sono concetti di prima
//    classe, non più fallback generici;
// 2. il fallback VERAMENTE generico (concetto "unknown"/"currency_generic"
//    quando le formule non si applicano) è SEMPRE variato per campo
//    (stringHash(fn) % 100), mai un seed condiviso fisso — così anche due
//    campi che restano genuinamente non classificati non collidono più.
//
// Dipendenze fra campi (sezione 6 della spec V3) — rappresentazione minima,
// non un formula engine general-purpose: un contesto condiviso fra i campi
// dello stesso record, letto/scritto in un ordine "sicuro" (vedi
// numericConceptRank sotto), MAI un'invenzione quando i dati non bastano
// (resta il fallback indipendente per quel campo).
//   subtotal    = quantity × unit_price       (se entrambi presenti)
//   labor_cost  = duration × rate             (se entrambi presenti)
//   total_cost  = subtotal + tax - discount   (se subtotal presente)
//               = Σ(labor_cost, material_cost) (altrimenti, se presenti)
//   margin      = revenue - total_cost        (se entrambi presenti)
interface FormulaContext {
  duration?: number;
  rate?: number;
  quantity?: number;
  unitPrice?: number;
  tax?: number;
  discount?: number;
  revenue?: number;
  subtotal?: number;
  totalCost?: number;
  /** "Cost part" raccolte per il fallback a somma di total_cost quando non
   * c'è un subtotal (stesso meccanismo v2: labor_cost/material_cost). */
  costParts: number[];
}

// ─── Range di magnitudine per dominio (CreatorAI V4, P1-4) ─────────────────
// Bug verificato dal vivo (benchmark post-hardening, scenario Immobiliare):
// il campo "prezzo" di un immobile veniva generato nel range generico
// unit_price/currency_generic (5-1500€), palesemente irrealistico per una
// compravendita immobiliare. Il tipo di campo (number/currency) era corretto
// — solo il RANGE era semanticamente sbagliato per il dominio. Soluzione
// volutamente minima (nessun "motore economico"): riusa la stessa categoria
// già calcolata da getPlaceholderCategoryForTable per titoli/immagini
// (recordPlaceholderImages.ts — 'veicoli'/'immobili'/'prodotti'/...), senza
// una seconda lista di nomi tabella hardcoded. Solo 'immobili' ha un range
// esplicito oggi (l'unico bug osservato): qualunque altra categoria, o
// nessuna categoria riconosciuta, ricade sul range generico invariato — gli
// altri domini già verificati corretti nel benchmark (fitness/prezzo_mensile,
// interventi/tariffa_oraria+costo_materiali, CRM/valore_stimato) restano
// quindi bit-per-bit identici a prima (nessuna regressione).
const DOMAIN_PRICE_RANGES: Partial<Record<PlaceholderCategory, [number, number]>> = {
  immobili: [80000, 480000],
};

/**
 * Genera un valore numerico "semantico" per il nome campo dato, condiviso
 * da entrambi i case "number" e "currency" di generateFieldValue — un campo
 * di costo può arrivare dichiarato come l'uno o l'altro (dal modello, o da
 * coerceObviousNumericFieldTypes in site-schema.ts) e deve comunque
 * partecipare alla stessa coerenza matematica.
 *
 * `tableName` (V4, P1-4): usato SOLO per stimare un range di magnitudine più
 * realistico sui rami di prezzo "generico" (unit_price/currency_generic/
 * total_cost quando calcolato senza subtotal/cost parts) — vedi
 * DOMAIN_PRICE_RANGES sopra. Nessun impatto sulla classificazione del
 * concetto stesso (resta esclusivamente sul nome campo, invariata).
 */
function generateSemanticNumber(fn: string, index: number, ctx: FormulaContext, tableName?: string): number {
  const concept = classifyFieldConcept(fn);
  // Variazione per-campo: applicata SEMPRE ai rami che prima usavano un seed
  // fisso condiviso (v2 Fix F.1 lo faceva solo per "costPart"/"costTotal" —
  // V3 lo estende a ogni ramo indipendente, il fix del residuo #2).
  const v = stringHash(fn) % 100;
  const category = tableName ? getPlaceholderCategoryForTable(tableName) : null;
  const domainRange = category ? DOMAIN_PRICE_RANGES[category] : undefined;
  switch (concept) {
    case 'year': return randomInt(2010, 2024, index + 300);
    case 'distance': return randomInt(0, 200000, index + 400);
    case 'quantity': {
      const val = randomInt(1, 50, index + 500);
      ctx.quantity = val;
      return val;
    }
    case 'percentage': return randomInt(5, 40, index + 550 + v);
    case 'score': return randomInt(1, 100, index + 560 + v);
    case 'duration': {
      // Ore per un singolo intervento/attività: un intero piccolo e
      // plausibile (non un importo), memorizzato nel contesto perché
      // "labor_cost" possa usarlo se generato dopo (stesso record).
      const val = randomInt(1, 10, index + 260);
      ctx.duration = val;
      return val;
    }
    case 'rate': {
      const val = randomInt(20, 80, index + 270);
      ctx.rate = val;
      return val;
    }
    case 'unit_price': {
      const val = domainRange
        ? randomInt(domainRange[0], domainRange[1], index + 280 + v)
        : randomInt(5, 500, index + 280 + v);
      ctx.unitPrice = val;
      return val;
    }
    case 'tax': {
      const val = randomInt(0, 100, index + 290 + v);
      ctx.tax = val;
      return val;
    }
    case 'discount': {
      const val = randomInt(0, 80, index + 295 + v);
      ctx.discount = val;
      return val;
    }
    case 'revenue': {
      const val = randomInt(500, 5000, index + 305 + v);
      ctx.revenue = val;
      return val;
    }
    case 'material_cost': {
      const val = randomInt(15, 1500, index + 600 + v);
      ctx.costParts.push(val);
      return val;
    }
    case 'labor_cost': {
      // Se duration+rate sono già disponibili sullo stesso record (stesso
      // ordine "sicuro" di calcolo, vedi numericConceptRank), il valore
      // riflette quella relazione invece di essere puramente indipendente.
      const val = (ctx.duration != null && ctx.rate != null)
        ? ctx.duration * ctx.rate
        : randomInt(15, 1500, index + 600 + v);
      ctx.costParts.push(val);
      return val;
    }
    case 'subtotal': {
      const val = (ctx.quantity != null && ctx.unitPrice != null)
        ? ctx.quantity * ctx.unitPrice
        : randomInt(15, 1500, index + 600 + v);
      ctx.subtotal = val;
      return val;
    }
    case 'total_cost': {
      let val: number;
      if (ctx.subtotal != null) val = ctx.subtotal + (ctx.tax ?? 0) - (ctx.discount ?? 0);
      else if (ctx.costParts.length > 0) val = ctx.costParts.reduce((a, b) => a + b, 0);
      else if (domainRange) val = randomInt(domainRange[0], domainRange[1], index + 600 + v);
      else val = randomInt(15, 1500, index + 600 + v);
      ctx.totalCost = val;
      return val;
    }
    case 'margin': {
      if (ctx.revenue != null && ctx.totalCost != null) return ctx.revenue - ctx.totalCost;
      if (ctx.revenue != null && ctx.costParts.length > 0) return ctx.revenue - ctx.costParts.reduce((a, b) => a + b, 0);
      return randomInt(-200, 2000, index + 610 + v);
    }
    // Qualunque altro campo "di valuta" riconosciuto ma senza un ruolo più
    // specifico (canone, importo generico...): indipendente, variato per
    // campo (mai lo stesso seed di un altro campo currency_generic dello
    // stesso record).
    case 'currency_generic':
      return domainRange
        ? randomInt(domainRange[0], domainRange[1], index + 600 + v)
        : randomInt(15, 1500, index + 600 + v);
    // Concetto non finanziario/non numerico riconosciuto su un campo
    // number/currency (raro ma possibile, es. "priorita" dichiarato number):
    // stesso fallback indipendente e variato del caso davvero sconosciuto.
    default:
      return randomInt(1, 100, index + 700 + v);
  }
}

/** Livello di calcolo di un campo number/currency (V3, generalizza il Fix
 * F.1 v2 a tutte le dipendenze della sezione 6): CORRETTO PER RUOLO
 * SEMANTICO, non per posizione nel blueprint — un blueprint reale può
 * elencare "total_cost" prima di "quantity"/"unit_price", e la coerenza non
 * deve dipendere da quello (verificato — CreatorAI V2 Final Semantic
 * Consistency Check).
 * - rank 1: valori indipendenti (duration/rate/quantity/unit_price/tax/
 *   discount/revenue/material_cost/year/distance/percentage/score/
 *   currency_generic/sconosciuto) — vanno per primi, così sono sempre
 *   disponibili quando serve calcolare un livello successivo.
 * - rank 2: subtotal (quantity×unit_price) e labor_cost (duration×rate) —
 *   possono dipendere dal rank 1.
 * - rank 3: total_cost — può dipendere da subtotal/tax/discount (rank
 *   1-2) o dalla somma delle cost part (rank 1-2).
 * - rank 4: margin — può dipendere da revenue (rank 1) e total_cost
 *   (rank 3).
 * Tutti gli altri tipi di campo restano a rank 0 (ordine originale,
 * comportamento invariato).
 */
function numericConceptRank(concept: SemanticConcept): number {
  if (concept === 'labor_cost' || concept === 'subtotal') return 2;
  if (concept === 'total_cost') return 3;
  if (concept === 'margin') return 4;
  return 1;
}

// ─── Date semantiche (CreatorAI V3, sezione 5) ─────────────────────────────
// v2 generava OGNI campo "date"/"datetime" con randomRecentDate(index): due
// campi data diversi sullo STESSO record (es. start_date/expiry_date)
// ricevevano quindi lo stesso identico valore, perché la funzione variava
// solo per indice record, mai per nome campo — bug osservato nel benchmark
// reale (issue #39, punto 2, esteso dai numeri alle date). V3 introduce:
// 1. una variazione per-campo (stessa idea di stringHash già usata sopra per
//    i numeri) — corregge la collisione anche quando le due date non hanno
//    un ruolo riconoscibile diverso;
// 2. quando il nome del campo indica chiaramente un ruolo "inizio"/"fine"
//    (start/end/deadline/scadenza), la data di fine viene generata DOPO
//    quella di inizio sullo stesso record e resta sempre successiva
//    (relazione plausibile start < end), mai un'invenzione quando manca un
//    campo "inizio" riconoscibile (resta un fallback indipendente).
interface DateFieldContext {
  start?: string;
}

function addDaysToDateString(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function randomRecentDate(index: number, fieldOffset = 0, maxDaysAgo = 540): string {
  const daysAgo = randomInt(0, maxDaysAgo, index + 100 + fieldOffset);
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function generateSemanticDate(fn: string, index: number, dateCtx: DateFieldContext): string {
  const concept = classifyFieldConcept(fn);
  const offset = stringHash(fn) % 180;
  switch (concept) {
    case 'date_birth': {
      // Età adulta plausibile (18-70 anni fa) — mai confusa con una data
      // "recente" (creazione/scadenza), l'errore più visibile se questo
      // ruolo non fosse distinto dagli altri.
      const daysAgo = randomInt(18 * 365, 70 * 365, index + 120 + offset);
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      return d.toISOString().slice(0, 10);
    }
    case 'date_start': {
      const val = randomRecentDate(index, offset);
      dateCtx.start = val;
      return val;
    }
    case 'date_end':
    case 'date_deadline': {
      // Se sullo stesso record esiste già una data di inizio (rank di
      // calcolo, vedi dateConceptRank sotto, garantisce che sia già stata
      // generata), la data di fine/scadenza resta SEMPRE successiva — mai
      // un'invenzione quando manca un campo "inizio" riconoscibile: in quel
      // caso resta un fallback indipendente, solo variato per campo.
      if (dateCtx.start) return addDaysToDateString(dateCtx.start, 14 + randomInt(0, 120, index + 130 + offset));
      return randomRecentDate(index, offset);
    }
    case 'date_updated':
      return randomRecentDate(index, offset, 90);
    case 'date_created':
    default:
      return randomRecentDate(index, offset);
  }
}

/** Stesso principio di numericConceptRank, applicato alle date: "fine"/
 * "scadenza" dopo "inizio", tutto il resto (incluso "sconosciuto") resta
 * indipendente (rank 1, ordine invariato tra loro). */
function dateConceptRank(concept: SemanticConcept): number {
  if (concept === 'date_end' || concept === 'date_deadline') return 2;
  return 1;
}

function generateFieldValue(
  field: FieldDef,
  identity: MockIdentity,
  index: number,
  tableName: string,
  relatedRecords: Record<string, { id: string }[]>,
  numberCtx: FormulaContext,
  dateCtx: DateFieldContext
): unknown {
  const fn = norm(fieldName(field));

  switch (field.type) {
    case 'checkbox':
      return index % 2 === 0;
    // Nessun case 'id' qui: FieldDef.type non lo include nemmeno (il campo
    // riservato "id" viene già filtrato da stripReservedIdField prima che
    // qualunque tabella arrivi a generateMockRecord, vedi page.tsx) — un
    // case per un valore che questo switch non può mai ricevere sarebbe
    // codice morto oltre che un errore di tipo.
    case 'state': {
      // Stesso trattamento di "select" sotto: un campo di stato (macchina a
      // stati, site-schema.ts Fase 4) ha il proprio vocabolario in
      // field.states, non in field.options.
      if (!field.states?.length) return 'Standard';
      return pick(field.states, index);
    }
    case 'select': {
      if (!field.options?.length) return 'Standard';
      return pick(field.options, index);
    }
    case 'multiselect': {
      if (!field.options?.length) return [];
      const a = pick(field.options, index);
      const b = pick(field.options, index + 1);
      return a === b ? [a] : [a, b];
    }
    case 'date':
    case 'datetime':
      return generateSemanticDate(fn, index, dateCtx);
    // "currency" e "number" condividono la STESSA inferenza semantica
    // (generateSemanticNumber sopra): un campo di costo può arrivare
    // dichiarato come l'uno o l'altro a seconda di come lo scrive il modello
    // (o di come coerceObviousNumericFieldTypes lo corregge, site-schema.ts).
    case 'currency':
    case 'number':
      return generateSemanticNumber(fn, index, numberCtx, tableName);
    case 'email':
      return `${slugifyForEmail(identity.firstName)}.${slugifyForEmail(identity.lastName)}@example.com`;
    case 'tel':
      return `3${randomInt(300000000, 399999999, index + 800)}`;
    case 'textarea':
      return pick(NOTES, index);
    case 'image':
    case 'file':
      // Niente valore: le immagini ricadono già sul placeholder automatico
      // per categoria, i file non hanno un mock sensato senza un file reale
      // — restano compilabili a mano.
      return undefined;
    case 'relation': {
      // CreatorAI v2 — coerenza tra entità collegate. Se sono già stati
      // generati (o esistono già) record reali della tabella target —
      // relationRecords, raccolta e passata dal chiamante (page.tsx) — si
      // collega a uno di quelli (ciclico per indice, stesso pattern
      // deterministico di pick()); altrimenti nessun valore (resta
      // compilabile a mano: non esiste alcun record reale a cui collegarsi).
      const target = field.targetTable;
      const candidates = target ? relatedRecords[target] : undefined;
      if (!candidates || candidates.length === 0) return undefined;
      return pick(candidates, index).id;
    }
    default: {
      // text e simili: classificazione semantica language-independent
      // (classifyFieldConcept, semantic-fields.ts) — sostituisce la lunga
      // catena di regex SOLO italiane della v2 (issue #39, punto 1).
      const concept = classifyFieldConcept(fn);
      switch (concept) {
        case 'company_name': return identity.companyName;
        case 'person_name':
          // "cognome"/"surname"/"last_name": lo stesso concetto person_name
          // copre sia nome che cognome (v3) — qui si distingue quale dei due
          // in base al nome specifico del campo, stesso comportamento v2.
          if (/cognome|surname|last.?name/.test(fn)) return identity.lastName;
          return identity.firstName;
        case 'address': return identity.street;
        case 'city': return identity.city;
        // CreatorAI V4 (P1-3, benchmark post-hardening): "telefono"/"email"
        // vengono classificati correttamente da classifyFieldConcept (regole
        // già presenti in semantic-fields.ts) ma, quando il blueprint AI
        // dichiara il campo come type:'text' invece del type:'tel'/'email'
        // dedicato (comportamento osservato dal vivo su 4/4 domini
        // testati), questo switch non aveva un case per i due concetti —
        // ricadeva quindi sul ramo `default` più sotto, mostrando la stessa
        // frase placeholder generica di descrizione ("Elemento monitorato
        // con cadenza regolare dal team operativo.") su un campo telefono/
        // email. Stessa forma già usata dai case dedicati 'tel'/'email' del
        // type-switch sopra (varia per record via `index`; il telefono varia
        // ANCHE per campo via stringHash, nel caso raro di più campi
        // telefono sullo stesso record — stesso principio già applicato a
        // tutti gli altri fallback di questo file).
        case 'phone':
          return `3${randomInt(300000000, 399999999, index + 800 + (stringHash(fn) % 100))}`;
        case 'email':
          return `${slugifyForEmail(identity.firstName)}.${slugifyForEmail(identity.lastName)}@example.com`;
        case 'plate':
          return `${pick(['AB', 'CD', 'EF', 'GH', 'LM'], index)}${String(randomInt(100, 999, index + 900))}${pick(['ZX', 'YW', 'VU', 'TS', 'RQ'], index + 1)}`;
        // Un campo TESTUALE il cui nome è chiaramente riconducibile a una
        // data (Fix F.2 v2, esteso a tutti i sotto-ruoli temporali v3): un
        // campo dichiarato esplicitamente "date"/"datetime" passa già dal
        // case dedicato sopra — questo si applica SOLO al ramo di default
        // testuale.
        case 'date_birth':
        case 'date_start':
        case 'date_end':
        case 'date_deadline':
        case 'date_created':
        case 'date_updated':
        case 'date_generic':
          return generateSemanticDate(fn, index, dateCtx);
        // "prodotto"/"articolo"/"modello": SEMPRE identity.categoryTitle —
        // quando la tabella ha una categoria nota (veicoli/immobili/...) è
        // esattamente il caso per cui quel pool esiste (es. "Fiat 500" per
        // un campo nome_prodotto su una tabella "veicoli").
        case 'product_name': return identity.categoryTitle;
        // Fallback monetario: un campo TESTUALE (non "number"/"currency",
        // già gestiti sopra) il cui nome indica comunque un valore economico
        // — merita un numero plausibile, variato per campo (mai lo stesso
        // seed di un altro campo finanziario testuale non riconosciuto dello
        // stesso record — stessa correzione della collisione già applicata
        // sopra ai campi number/currency).
        case 'unit_price':
        case 'subtotal':
        case 'tax':
        case 'discount':
        case 'revenue':
        case 'margin':
        case 'labor_cost':
        case 'material_cost':
        case 'currency_generic':
          return randomInt(15, 1500, index + 250 + (stringHash(fn) % 100));
        // Campo "ore" (es. "ore_lavorate") dichiarato testo: un intero
        // plausibile, non testo (Fix #1 v1.1).
        case 'duration':
          return randomInt(1, 40, index + 260);
        // "note": pool dedicato SEMPRE, indipendentemente da hasCategory —
        // una nota non è mai legittimamente rappresentata da un nome di
        // categoria (es. "Villa con Giardino" su un campo note non ha senso).
        case 'notes': return pickForField(GENERIC_NOTES, tableName, field, index);
        // "descrizione": stesso principio, pool dedicato sempre.
        case 'description': return pickForField(GENERIC_DESCRIPTIONS, tableName, field, index);
        // "titolo"/"oggetto" generico (non prodotto, già gestito sopra): se
        // la tabella ha una categoria reale, categoryTitle resta corretto e
        // specifico del dominio — altrimenti, invece del pool generico
        // CONDIVISO da ogni altro campo non riconosciuto dello stesso
        // record, un pool dedicato variato per campo/indice.
        case 'title':
          return identity.hasCategory ? identity.categoryTitle : pickForField(GENERIC_TITLES_FALLBACK, tableName, field, index);
        // Nessuna euristica ha riconosciuto il campo (concept "unknown", o
        // un concetto testuale/workflow senza generatore ad hoc dedicato —
        // es. "priority"/"stage" dichiarati testo): stessa logica di
        // "titolo" — la categoria reale resta prioritaria, altrimenti un
        // pool generico variato per campo/indice invece del valore
        // condiviso da tutto il record.
        default:
          if (identity.hasCategory) return identity.categoryTitle;
          return pickForField(GENERIC_DESCRIPTIONS, tableName, field, index);
      }
    }
  }
}

/**
 * Genera un record di esempio (indice 0-based, tipicamente 0..4) per una
 * tabella.
 *
 * `relatedRecords` (CreatorAI v2, facoltativo — default {}, comportamento
 * pre-esistente invariato se omesso): mappa nome-tabella-target -> record
 * reali già esistenti, usata per collegare i campi "relation" a un record
 * vero invece di lasciarli vuoti (vedi generateFieldValue). Stessa forma
 * già usata da page.tsx::relationRecords, nessun tipo nuovo da mantenere in
 * sincronia altrove.
 *
 * Ordine di calcolo "sicuro" (CreatorAI v2 Fix F.1, generalizzato in V3 a
 * date + più livelli di formula, vedi numericConceptRank/dateConceptRank):
 * i campi number/currency/date/datetime vengono calcolati in un ordine
 * derivato dal loro RUOLO SEMANTICO (mai dalla posizione nel blueprint), poi
 * il record restituito viene ricostruito nell'ordine di dichiarazione
 * ORIGINALE — il riordino è solo un dettaglio interno di calcolo, mai un
 * cambiamento visibile nell'ordine dei campi.
 */
function computationRank(field: FieldDef): number {
  if (field.type === 'number' || field.type === 'currency') {
    return numericConceptRank(classifyFieldConcept(fieldName(field)));
  }
  if (field.type === 'date' || field.type === 'datetime') {
    return dateConceptRank(classifyFieldConcept(fieldName(field)));
  }
  return 0;
}

export function generateMockRecord(
  table: TableDef,
  index: number,
  relatedRecords: Record<string, { id: string }[]> = {}
): Record<string, unknown> {
  const identity = buildIdentity(table, index);
  const numberCtx: FormulaContext = { costParts: [] };
  const dateCtx: DateFieldContext = {};

  // Calcola nell'ordine "sicuro" (rank crescente, stabile a parità di rank)...
  const computationOrder = table.fields
    .map((field, position) => ({ field, position, rank: computationRank(field) }))
    .sort((a, b) => a.rank - b.rank || a.position - b.position)
    .map((x) => x.field);

  const computed = new Map<FieldDef, unknown>();
  for (const field of computationOrder) {
    computed.set(field, generateFieldValue(field, identity, index, table.name, relatedRecords, numberCtx, dateCtx));
  }

  // ...ma il record restituito mantiene l'ordine di dichiarazione ORIGINALE
  // del blueprint (stesso ordine di sempre per le colonne della tabella).
  const record: Record<string, unknown> = {};
  for (const field of table.fields) {
    const value = computed.get(field);
    if (value !== undefined) record[fieldName(field)] = value;
  }
  return record;
}
