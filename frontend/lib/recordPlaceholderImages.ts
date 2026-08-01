// ─── Immagini placeholder per record (tabelle "visive") ────────────────────
// Le tabelle generate dall'AI raramente hanno foto reali caricate dal
// cliente: senza immagini, elenchi di prodotti/veicoli/piatti sembrano
// "semplici caselle" invece di una vetrina invitante. Come nella landing
// hero (lib/landingHero.ts), assegniamo una foto HD Unsplash verificata e
// contestuale al settore/tipo di tabella — deterministica per record (stesso
// id → sempre la stessa foto, niente "sfarfallio" tra un render e l'altro).
//
// Applicata SOLO a categorie di prodotto/oggetto/servizio impersonale
// (veicoli, immobili, prodotti, piatti, corsi, eventi, attrezzature, servizi):
// mai a persone (pazienti, clienti, dipendenti) per non attribuire volti reali
// di sconosciuti a identità fittizie nei dati demo.

export type PlaceholderCategory =
  | 'veicoli' | 'immobili' | 'prodotti' | 'piatti'
  | 'corsi' | 'eventi' | 'attrezzature' | 'servizi';

const CATEGORY_IMAGES: Record<PlaceholderCategory, string[]> = {
  veicoli: [
    '1494976388531-d1058494cdd8',
    '1503376780353-7e6692767b70',
    '1583121274602-3e2820c69888',
    '1542362567-b07e54358753',
    '1567818735868-e71b99932e29',
  ],
  immobili: [
    '1493663284031-b7e3aefcae8e',
    '1484154218962-a197022b5858',
    '1560518883-ce09059eeffa',
    '1583847268964-b28dc8f51f92',
    '1484101403633-562f891dc89a',
  ],
  prodotti: [
    '1556911220-e15b29be8c8f',
    '1512621776951-a57141f2eefd',
    '1571091718767-18b5b1457add',
    '1441986300917-64674bd600d8',
  ],
  piatti: [
    '1467003909585-2f8a72700288',
    '1546069901-ba9599a7e63c',
    '1571997478779-2adcbbe9ab2f',
    '1550547660-d9450f859349',
  ],
  corsi: [
    '1523240795612-9a054b0db644',
    '1522202176988-66273c2fd55f',
    '1524995997946-a1c2e315a42f',
    '1503676260728-1c00da094a0b',
  ],
  eventi: [
    '1511578314322-379afb476865',
    '1470229722913-7c0e2dbbafd3',
    '1519671482749-fd09be7ccebf',
    '1552664730-d307ca884978',
  ],
  attrezzature: [
    '1581091226825-a6a2a5aee158',
    '1504328345606-18bbc8c9d7d1',
    '1571019613454-1cb2f99b2d8b',
  ],
  servizi: [
    '1560250097-0b93528c311a',
    '1454165804606-c3d57bc86b40',
    '1516321318423-f06f85e504b3',
  ],
};

// Termini di ruolo/persona che condividono lo stesso prefisso di una parola
// chiave prodotto qui sotto (es. "magazzinieri" contiene "magazzin", la
// stessa radice usata per il magazzino prodotti): controllati PRIMA e a
// esclusione, altrimenti il match per sottostringa assegnerebbe foto
// placeholder anonime a persone reali, violando la regola dichiarata sopra
// ("mai a persone: pazienti, clienti, dipendenti").
const PERSON_KEYWORDS = [
  'magazzinier', // magazziniere/i — collide con 'magazzin' (prodotti)
  'macchinist', // macchinista/i — collide con 'macchin' (veicoli)
  'dipendent', 'personale', 'staff', 'collaborator',
  'client', 'pazient', 'utente', 'utenti', 'agente', 'agenti',
  'autista', 'autisti', 'camionista', 'camionisti', 'operaio', 'operai', 'fornitor',
];

// Nomi tabella (in minuscolo) → categoria. Match per sottostringa, come per
// designTokens/iconResolver: copre sia il singolare che varianti comuni.
const TABLE_NAME_CATEGORY: Array<{ keywords: string[]; category: PlaceholderCategory }> = [
  { category: 'veicoli', keywords: ['veicol', 'auto', 'macchin', 'moto', 'vettur', 'parco_auto', 'parco auto'] },
  { category: 'immobili', keywords: ['immobil', 'propriet', 'appartament', 'cas', 'stanz', 'camer', 'annunci'] },
  { category: 'piatti', keywords: ['piatt', 'menu', 'ricett', 'pizz', 'dish'] },
  { category: 'prodotti', keywords: ['prodott', 'articol', 'magazzin', 'ricambi', 'inventario', 'catalogo'] },
  { category: 'corsi', keywords: ['corsi', 'corso', 'lezioni', 'formazione', 'workshop', 'seminari'] },
  { category: 'eventi', keywords: ['eventi', 'evento', 'concert', 'spettacol', 'fiera'] },
  { category: 'attrezzature', keywords: ['attrezzatur', 'strumenti', 'utensili', 'macchinari', 'equipment', 'noleggio'] },
  { category: 'servizi', keywords: ['servizi', 'pacchetti', 'abbonamenti'] },
];

/** Determina se una tabella è "visiva" (merita foto/griglia) in base al nome. */
export function getPlaceholderCategoryForTable(tableName: string): PlaceholderCategory | null {
  const normalized = tableName.toLowerCase();
  if (PERSON_KEYWORDS.some((kw) => normalized.includes(kw))) return null;
  for (const { keywords, category } of TABLE_NAME_CATEGORY) {
    if (keywords.some((kw) => normalized.includes(kw))) return category;
  }
  return null;
}

// Hash semplice e stabile (stringa → intero positivo) per scegliere sempre
// la stessa foto per lo stesso record, senza dipendenze esterne.
function stableHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** URL Unsplash HD deterministico per un record, dato l'id e la categoria. */
export function getPlaceholderImageUrl(category: PlaceholderCategory, recordId: string): string {
  const photos = CATEGORY_IMAGES[category];
  const photo = photos[stableHash(recordId) % photos.length];
  return `https://images.unsplash.com/photo-${photo}?auto=format&fit=crop&w=600&q=80`;
}
