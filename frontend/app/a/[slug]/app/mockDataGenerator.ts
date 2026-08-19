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

function pick<T>(arr: T[], index: number): T {
  return arr[((index % arr.length) + arr.length) % arr.length];
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

function generateFieldValue(field: FieldDef, identity: MockIdentity, index: number): unknown {
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
      if (/nome.?prodotto|articolo|modello/.test(fn) || fnTokens.includes('prodotto') || fnTokens.includes('titolo')) return identity.categoryTitle;
      // Fallback monetario: un campo TESTUALE (non "number"/"currency", già
      // gestiti sopra) il cui nome indica comunque un valore economico —
      // es. "valore_stimato" su un'entità tipo CRM/opportunità, scritto come
      // testo libero anziché come number nel blueprint — merita comunque un
      // numero plausibile, non lo stesso titolo generico degli altri campi
      // non riconosciuti del record.
      if (/valore|importo|prezzo|costo|totale|tariffa|stimato/.test(fn)) return randomInt(15, 1500, index + 250);
      return identity.categoryTitle;
    }
  }
}

/** Genera un record di esempio (indice 0-based, tipicamente 0..4) per una tabella. */
export function generateMockRecord(table: TableDef, index: number): Record<string, unknown> {
  const identity = buildIdentity(table, index);
  const record: Record<string, unknown> = {};
  for (const field of table.fields) {
    const value = generateFieldValue(field, identity, index);
    if (value !== undefined) record[fieldName(field)] = value;
  }
  return record;
}
