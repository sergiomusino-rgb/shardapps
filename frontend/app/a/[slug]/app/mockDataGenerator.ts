/**
 * Generatore di record di esempio, per popolare una tabella appena creata
 * (vuota) con dati plausibili invece di caselle vuote — stesso spirito
 * delle foto placeholder contestuali in recordPlaceholderImages.ts, ma per
 * il testo: euristiche sul nome/tipo di campo, nessuna chiamata AI (niente
 * costo, niente latenza, deterministico).
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
 * point, come tante implementazioni minimali di string-hash) — usato SOLO
 * per far dipendere la scelta nel pool anche dal nome del campo, non solo
 * dall'indice del record. */
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

/** Normalizza per il matching sul nome campo: minuscolo, senza accenti. */
function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Spezza un nome campo normalizzato nei suoi "token" (separati da
 * underscore/spazi/altri non-alfanumerici) — es. "nome_lead" -> ["nome",
 * "lead"], "valoreStimato" (già in minuscolo da norm) resta un unico token
 * ma "valore_stimato" -> ["valore", "stimato"]. Usato per i pattern che
 * prima richiedevano una corrispondenza ESATTA sull'intero nome campo
 * (es. /^nome$/, che non intercetta "nome_lead" o "nome_cliente_finale"):
 * un campo con id composto è comunissimo nei blueprint generati dall'AI e
 * prima ricadeva silenziosamente nel catch-all generico (bug osservato nel
 * benchmark: "Elemento Epsilon" ripetuto su più campi dello stesso record).
 */
function tokens(fn: string): string[] {
  return fn.split(/[^a-z0-9]+/).filter(Boolean);
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

function randomInt(min: number, max: number, seed: number): number {
  // Variazione pseudo-casuale ma deterministica (stesso indice → stesso
  // valore): evita mock diversi ad ogni refresh accidentale del form.
  const x = Math.sin(seed * 999) * 10000;
  const frac = x - Math.floor(x);
  return min + Math.floor(frac * (max - min + 1));
}

function randomRecentDate(index: number): string {
  const daysAgo = randomInt(0, 540, index + 100);
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function generateFieldValue(field: FieldDef, identity: MockIdentity, index: number, tableName: string): unknown {
  const fn = norm(fieldName(field));
  const fnTokens = tokens(fn);

  switch (field.type) {
    case 'checkbox':
      return index % 2 === 0;
    // Nessun case 'id' qui: FieldDef.type non lo include nemmeno (il campo
    // riservato "id" viene già filtrato da stripReservedIdField prima che
    // qualunque tabella arrivi a generateMockRecord, vedi page.tsx) — un
    // case per un valore che questo switch non può mai ricevere sarebbe
    // codice morto oltre che un errore di tipo.
    case 'state': {
      // Stesso trattamento di "select" sopra: un campo di stato (macchina a
      // stati, site-schema.ts Fase 4) ha il proprio vocabolario in
      // field.states, non in field.options. Prima non esisteva questo case:
      // ricadeva nel "default" testuale, dove il nome del campo (es. "stato",
      // "stato_pipeline") raramente incrocia le regex euristiche e collassa
      // sul catch-all identity.categoryTitle — lo stesso identico bug del
      // caso "id" sopra, osservato nel benchmark.
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
      return randomRecentDate(index);
    case 'currency':
      return randomInt(15, 1500, index + 200);
    case 'number': {
      if (/anno/.test(fn)) return randomInt(2010, 2024, index + 300);
      if (/km|chilometra/.test(fn)) return randomInt(0, 200000, index + 400);
      if (/quantit|qta/.test(fn)) return randomInt(1, 50, index + 500);
      if (/prezzo|costo|importo|totale/.test(fn)) return randomInt(15, 1500, index + 600);
      return randomInt(1, 100, index + 700);
    }
    case 'email':
      return `${slugifyForEmail(identity.firstName)}.${slugifyForEmail(identity.lastName)}@example.com`;
    case 'tel':
      return `3${randomInt(300000000, 399999999, index + 800)}`;
    case 'textarea':
      return pick(NOTES, index);
    case 'image':
    case 'file':
    case 'relation':
      // Niente valore: le immagini ricadono già sul placeholder automatico
      // per categoria, file/relazioni non hanno un mock sensato senza dati
      // reali da collegare — restano compilabili a mano.
      return undefined;
    default: {
      // text e simili: euristica sul nome del campo. Gli anchor esatti
      // (^nome$, ^via$, ^prodotto$, ^titolo$) di prima matchavano SOLO un
      // campo chiamato letteralmente così — un id composto come "nome_lead"
      // o "nome_cliente_finale" (comunissimo nei blueprint generati dall'AI)
      // non incrociava nessuna regex e cadeva nel catch-all generico
      // (identity.categoryTitle ripetuto su più campi dello stesso record,
      // il bug osservato nel benchmark). Ora l'anchor esatto è sostituito da
      // un controllo sui token del nome campo (fnTokens), che riconosce
      // "nome" anche dentro "nome_lead" senza però confondersi con parole
      // che lo contengono come sottostringa (es. "nomenclatura").
      if (/ragione.?sociale|azienda|societ|impresa|fornitore/.test(fn)) return identity.companyName;
      if (/cognome/.test(fn)) return identity.lastName;
      if ((fnTokens.includes('nome') || /cliente|titolare|referente|contatto|nominativo/.test(fn)) && !/prodotto|nome.?prodotto/.test(fn)) return identity.firstName;
      if (/indirizzo/.test(fn) || fnTokens.includes('via')) return identity.street;
      if (/citt|comune/.test(fn)) return identity.city;
      if (/targa/.test(fn)) return `${pick(['AB', 'CD', 'EF', 'GH', 'LM'], index)}${String(randomInt(100, 999, index + 900))}${pick(['ZX', 'YW', 'VU', 'TS', 'RQ'], index + 1)}`;
      // "prodotto"/"articolo"/"modello": SEMPRE identity.categoryTitle —
      // quando la tabella ha una categoria nota (veicoli/immobili/...) è
      // esattamente il caso per cui quel pool esiste (es. "Fiat 500" per un
      // campo nome_prodotto su una tabella "veicoli"), comportamento
      // verificato e da NON toccare. Separato da "titolo" sotto (Quality
      // Pass v1.1, Fix #1): un titolo generico senza contesto di prodotto
      // non deve più condividere lo stesso valore quando manca una
      // categoria reale.
      if (/nome.?prodotto|articolo|modello/.test(fn) || fnTokens.includes('prodotto')) return identity.categoryTitle;
      // Fallback monetario: un campo TESTUALE (non "number"/"currency", già
      // gestiti sopra) il cui nome indica comunque un valore economico —
      // es. "valore_stimato" su un'entità tipo CRM/opportunità, scritto come
      // testo libero anziché come number nel blueprint — merita comunque un
      // numero plausibile, non lo stesso titolo generico degli altri campi
      // non riconosciuti del record.
      if (/valore|importo|prezzo|costo|totale|tariffa|stimato/.test(fn)) return randomInt(15, 1500, index + 250);
      // Campo "ore" (es. "ore_lavorate"): un intero plausibile, non testo —
      // stesso principio del fallback monetario sopra, per un campo che il
      // blueprint può dichiarare "text" anche quando concettualmente è un
      // numero (Quality Pass v1.1, Fix #1 — osservato in produzione su
      // un'entità "interventi").
      if (fnTokens.includes('ore') || /ore.?lavorate|numero.?ore/.test(fn)) return randomInt(1, 40, index + 260);
      // "note": pool dedicato SEMPRE, indipendentemente da hasCategory — una
      // nota non è mai legittimamente rappresentata da un nome di categoria
      // (es. "Villa con Giardino" su un campo note non ha senso). Substring,
      // non anchor esatto: copre anche id composti come "note_libere_xyz".
      if (/note|annotazion/.test(fn)) return pickForField(GENERIC_NOTES, tableName, field, index);
      // "descrizione": stesso principio, pool dedicato sempre.
      if (/descrizion/.test(fn)) return pickForField(GENERIC_DESCRIPTIONS, tableName, field, index);
      // "titolo"/"oggetto" generico (non prodotto, già gestito sopra): se la
      // tabella ha una categoria reale, categoryTitle resta corretto e
      // specifico del dominio (comportamento già funzionante, non
      // regredito) — altrimenti, invece del pool generico CONDIVISO da ogni
      // altro campo non riconosciuto dello stesso record, un pool dedicato
      // variato per campo/indice.
      if (fnTokens.includes('titolo') || fnTokens.includes('oggetto')) {
        return identity.hasCategory ? identity.categoryTitle : pickForField(GENERIC_TITLES_FALLBACK, tableName, field, index);
      }
      // Ultimo fallback (nessuna euristica sopra ha riconosciuto il campo):
      // stessa logica di "titolo" — la categoria reale resta prioritaria
      // (comportamento pre-esistente, invariato), altrimenti un pool
      // generico variato per campo/indice invece del valore condiviso da
      // tutto il record (il bug residuo osservato nella validazione
      // production del Quality Pass v1).
      if (identity.hasCategory) return identity.categoryTitle;
      return pickForField(GENERIC_DESCRIPTIONS, tableName, field, index);
    }
  }
}

/** Genera un record di esempio (indice 0-based, tipicamente 0..4) per una tabella. */
export function generateMockRecord(table: TableDef, index: number): Record<string, unknown> {
  const identity = buildIdentity(table, index);
  const record: Record<string, unknown> = {};
  for (const field of table.fields) {
    const value = generateFieldValue(field, identity, index, table.name);
    if (value !== undefined) record[fieldName(field)] = value;
  }
  return record;
}
