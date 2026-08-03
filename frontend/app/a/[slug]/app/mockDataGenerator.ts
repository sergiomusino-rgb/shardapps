/**
 * Generatore di record di esempio, per popolare una tabella appena creata
 * (vuota) con dati plausibili invece di caselle vuote — stesso spirito
 * delle foto placeholder contestuali in recordPlaceholderImages.ts, ma per
 * il testo: euristiche sul nome/tipo di campo, nessuna chiamata AI (niente
 * costo, niente latenza, deterministico).
 */

import { TableDef, FieldDef, fieldName } from './table-definitions';
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

  switch (field.type) {
    case 'checkbox':
      return index % 2 === 0;
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
      // text e simili: euristica sul nome del campo
      if (/ragione.?sociale|azienda|societ|impresa|fornitore/.test(fn)) return identity.companyName;
      if (/cognome/.test(fn)) return identity.lastName;
      if (/^nome$|cliente|titolare|referente|contatto|nominativo/.test(fn) && !/prodotto|nome.?prodotto/.test(fn)) return identity.firstName;
      if (/indirizzo|^via$/.test(fn)) return identity.street;
      if (/citt|comune/.test(fn)) return identity.city;
      if (/targa/.test(fn)) return `${pick(['AB', 'CD', 'EF', 'GH', 'LM'], index)}${String(randomInt(100, 999, index + 900))}${pick(['ZX', 'YW', 'VU', 'TS', 'RQ'], index + 1)}`;
      if (/nome.?prodotto|^prodotto$|articolo|modello|^titolo$|^nome$/.test(fn)) return identity.categoryTitle;
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
