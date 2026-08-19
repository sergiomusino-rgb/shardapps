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

// ─── Inferenza semantica dei campi numerici (CreatorAI v2, Fix F.1) ────────
// Problema osservato in produzione (Quality Pass v1.1, report finale F.1):
// campi come costo_manodopera/costo_materiali/costo_totale/tariffa_oraria,
// tutti type:"number", ricadevano sullo stesso identico fallback generico
// (`randomInt(15, 1500, index + 600)`, stesso seed per qualunque nome campo)
// — stesso identico valore ripetuto su più campi dello stesso record, la
// stessa classe di bug già corretta per i campi TESTUALI in v1.1, qui
// osservata nel ramo "number". Non è un secondo sistema: è la stessa idea
// (un fallback che dipende dal nome campo, non condiviso) applicata anche
// qui, più un minimo di coerenza matematica tra campi collegati
// (manodopera ≈ ore × tariffa, totale ≈ somma delle parti) quando i nomi
// dei campi la suggeriscono chiaramente — mai un'invenzione se il pattern
// non è riconoscibile, in quel caso resta il fallback indipendente per
// campo (mai la stessa formula "matematicamente perfetta" imposta a forza).
type NumberFieldRole = 'duration' | 'rate' | 'costPart' | 'costTotal' | 'percentage' | 'quantity' | 'year' | 'km' | 'generic';

function classifyNumberField(fn: string): NumberFieldRole {
  if (/anno/.test(fn)) return 'year';
  if (/km|chilometra/.test(fn)) return 'km';
  if (/percentual|^perc$|sconto|\biva\b|margine/.test(fn)) return 'percentage';
  if (/quantit|^qta$/.test(fn)) return 'quantity';
  // "durata"/"ore" (ore_lavorate, durata_intervento, numero_ore): una
  // quantità di tempo, non una valuta — deve restare un intero piccolo e
  // plausibile (poche ore per intervento), non un importo in euro.
  if (/^ore$|ore.?lavorate|numero.?ore|durata/.test(fn)) return 'duration';
  // "tariffa"/"costo orario": una TARIFFA (valuta per unità), non un
  // importo totale — va generata PRIMA delle cost part derivate, cosicché
  // "costo_manodopera" possa usarla se il nome lo suggerisce.
  if (/tariffa|costo.?orario|prezzo.?orario/.test(fn)) return 'rate';
  // "totale"/"costo totale": va calcolato per ULTIMO (vedi generateMockRecord,
  // due passate), come somma delle cost part già generate sullo stesso
  // record, quando ce ne sono — altrimenti resta un fallback indipendente.
  if (/costo.?totale|totale|importo.?totale|prezzo.?totale/.test(fn)) return 'costTotal';
  // Qualunque altro campo "di valuta" (prezzo, costo, importo, valore,
  // canone...): una "parte" di costo, generata indipendentemente a meno che
  // il nome non suggerisca esplicitamente "manodopera"/"lavoro" — in quel
  // caso, se duration+rate sono già stati generati sullo stesso record,
  // costo_manodopera ≈ ore × tariffa (vedi generateSemanticNumber sotto).
  if (/costo|prezzo|importo|valore|tariffa|canone/.test(fn)) return 'costPart';
  return 'generic';
}

/**
 * Genera un valore numerico "semantico" per il nome campo dato, condiviso
 * da entrambi i case "number" e "currency" di generateFieldValue — un campo
 * di costo può arrivare dichiarato come l'uno o l'altro (dal modello, o da
 * coerceObviousNumericFieldTypes in site-schema.ts) e deve comunque
 * partecipare alla stessa coerenza ore×tariffa/somma-delle-parti.
 */
function generateSemanticNumber(fn: string, index: number, numberCtx: NumberFieldContext): number {
  const role = classifyNumberField(fn);
  switch (role) {
    case 'year': return randomInt(2010, 2024, index + 300);
    case 'km': return randomInt(0, 200000, index + 400);
    case 'quantity': return randomInt(1, 50, index + 500);
    case 'percentage': return randomInt(5, 40, index + 550);
    case 'duration': {
      // Ore per un singolo intervento/attività: un intero piccolo e
      // plausibile (non un importo), memorizzato nel contesto perché
      // "costo_manodopera" possa usarlo se generato dopo (stesso record).
      const v = randomInt(1, 10, index + 260);
      numberCtx.duration = v;
      return v;
    }
    case 'rate': {
      const v = randomInt(20, 80, index + 270);
      numberCtx.rate = v;
      return v;
    }
    case 'costPart': {
      // "manodopera"/"lavoro": se duration+rate sono già disponibili sullo
      // stesso record (stesso ordine di dichiarazione dei campi del
      // blueprint — tipicamente ore poi tariffa poi costo manodopera), il
      // valore riflette quella relazione invece di essere puramente
      // indipendente. Fallback indipendente ma VARIATO PER CAMPO (non lo
      // stesso seed di ogni altra "cost part" dello stesso record — il bug
      // F.1 osservato in produzione) quando la relazione non si applica o i
      // dati non sono disponibili.
      const isManodopera = /manodopera|lavoro|labor/.test(fn);
      const v = (isManodopera && numberCtx.duration != null && numberCtx.rate != null)
        ? numberCtx.duration * numberCtx.rate
        : randomInt(15, 1500, index + 600 + (stringHash(fn) % 100));
      numberCtx.costParts.push(v);
      return v;
    }
    case 'costTotal': {
      // Somma delle "cost part" già generate sullo stesso record, quando ce
      // ne sono (vedi generateMockRecord: i campi costTotal sono generati in
      // una seconda passata, DOPO tutte le altre) — altrimenti un fallback
      // indipendente, mai il valore condiviso con altri campi.
      if (numberCtx.costParts.length > 0) return numberCtx.costParts.reduce((a, b) => a + b, 0);
      return randomInt(15, 1500, index + 600 + (stringHash(fn) % 100));
    }
    default:
      return randomInt(1, 100, index + 700);
  }
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

/** Contesto condiviso tra i campi dello stesso record, per la coerenza
 * matematica di CreatorAI v2 (Fix F.1) — vedi classifyNumberField sopra.
 * Puramente additivo: un record senza campi duration/rate/costPart si
 * comporta esattamente come prima (fallback indipendenti per campo). */
interface NumberFieldContext {
  duration?: number;
  rate?: number;
  costParts: number[];
}

function generateFieldValue(
  field: FieldDef,
  identity: MockIdentity,
  index: number,
  tableName: string,
  relatedRecords: Record<string, { id: string }[]>,
  numberCtx: NumberFieldContext
): unknown {
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
    // "currency" e "number" condividono la STESSA inferenza semantica
    // (generateSemanticNumber sotto): un campo di costo può arrivare
    // dichiarato come l'uno o l'altro a seconda di come lo scrive il modello
    // (o di come coerceObviousNumericFieldTypes lo corregge, site-schema.ts)
    // — la coerenza ore×tariffa/costo_totale deve valere in entrambi i casi,
    // non solo per "number" (altrimenti un campo "costo_totale" coerto a
    // "currency" perderebbe la somma delle cost part e tornerebbe a un
    // valore indipendente, lo stesso bug F.1 da un'altra porta).
    case 'currency':
    case 'number':
      return generateSemanticNumber(fn, index, numberCtx);
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
      // CreatorAI v2 — coerenza tra entità collegate (Sezione 9/criterio di
      // successo: "Cliente = Acme SRL" deve comparire IDENTICO sia sul
      // cliente sia sull'intervento collegato). Se sono già stati generati
      // (o esistono già) record reali della tabella target — relationRecords,
      // già raccolta e passata dal chiamante (page.tsx, stessa mappa già
      // usata per risolvere le relation nelle celle della tabella, non un
      // meccanismo nuovo) — si collega a uno di quelli (ciclico per indice,
      // stesso pattern deterministico di pick()); altrimenti nessun valore,
      // comportamento pre-esistente invariato (resta compilabile a mano: non
      // esiste alcun record reale a cui collegarsi).
      const target = field.targetTable;
      const candidates = target ? relatedRecords[target] : undefined;
      if (!candidates || candidates.length === 0) return undefined;
      return pick(candidates, index).id;
    }
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
      // CreatorAI v2 (Fix F.2): un campo TESTUALE il cui nome è chiaramente
      // riconducibile a una data (data_*, *_data, scadenza, deadline,
      // created_at/updated_at) — osservato in produzione: "data_chiusura_prevista"
      // dichiarato "text" mostrava una frase generica invece di una data
      // plausibile. Fallback controllato: si applica SOLO qui, nel ramo
      // testuale di default — un campo dichiarato esplicitamente "date"/
      // "datetime" passa già dal case dedicato sopra (randomRecentDate),
      // che continua a prevalere sempre; questo non lo tocca in alcun modo.
      if (fnTokens.includes('data') || fnTokens.includes('scadenza') || fnTokens.includes('deadline') || /created.?at|updated.?at/.test(fn)) {
        return randomRecentDate(index);
      }
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
 * Due passate (CreatorAI v2, Fix F.1): i campi numerici classificati come
 * "costTotal" (es. costo_totale) sono generati DOPO tutti gli altri campi
 * dello stesso record, così possono sommare le "cost part" (es.
 * costo_manodopera + costo_materiali) già calcolate nella prima passata —
 * un record senza questo pattern si comporta esattamente come una singola
 * passata (nessun campo deferred, nessun cambio di comportamento).
 */
/**
 * Livello di calcolo di un campo number/currency, per la coerenza
 * ore×tariffa/somma-delle-parti (CreatorAI v2, Fix F.1) — CORRETTO PER
 * RUOLO SEMANTICO, non per posizione nel blueprint: un blueprint reale può
 * elencare "costo_totale" prima di "ore_lavorate" (l'ordine dei campi non è
 * mai garantito dal modello), e la coerenza non deve dipendere da quello.
 * - livello 1: duration/rate (nessuna dipendenza — vanno per prime, così
 *   sono sempre disponibili quando serve calcolare una cost part) e
 *   qualunque altro ruolo indipendente (year/km/quantity/percentage/generic).
 * - livello 2: costPart (può dipendere da duration+rate, livello 1).
 * - livello 3: costTotal (dipende dalle costPart già generate, livello 2).
 * Tutti gli altri tipi di campo restano a livello 0 (ordine originale,
 * comportamento invariato).
 */
function numericComputationRank(field: FieldDef): number {
  if (field.type !== 'number' && field.type !== 'currency') return 0;
  const role = classifyNumberField(norm(fieldName(field)));
  if (role === 'costPart') return 2;
  if (role === 'costTotal') return 3;
  return 1;
}

export function generateMockRecord(
  table: TableDef,
  index: number,
  relatedRecords: Record<string, { id: string }[]> = {}
): Record<string, unknown> {
  const identity = buildIdentity(table, index);
  const numberCtx: NumberFieldContext = { costParts: [] };

  // Calcola nell'ordine "sicuro" (rank crescente, stabile a parità di rank —
  // vedi numericComputationRank sopra)...
  const computationOrder = table.fields
    .map((field, position) => ({ field, position, rank: numericComputationRank(field) }))
    .sort((a, b) => a.rank - b.rank || a.position - b.position)
    .map((x) => x.field);

  const computed = new Map<FieldDef, unknown>();
  for (const field of computationOrder) {
    computed.set(field, generateFieldValue(field, identity, index, table.name, relatedRecords, numberCtx));
  }

  // ...ma il record restituito mantiene l'ordine di dichiarazione ORIGINALE
  // del blueprint (stesso ordine di sempre per le colonne della tabella):
  // il riordino sopra è solo un dettaglio interno di calcolo, mai un
  // cambiamento visibile nell'ordine dei campi.
  const record: Record<string, unknown> = {};
  for (const field of table.fields) {
    const value = computed.get(field);
    if (value !== undefined) record[fieldName(field)] = value;
  }
  return record;
}
