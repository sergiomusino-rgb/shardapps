// ─── Landing Hero Content per Design Key ────────────────────────────────────
// Contenuti editoriali (immagine Unsplash contestuale, badge di settore,
// parola chiave da evidenziare e tagline) allineati ai design token di
// ciascun settore in designTokens.ts. Usati esclusivamente dalla landing
// pubblica (LandingPublic in app/a/[slug]/page.tsx) per generare un hero
// a due colonne con personalità visiva reale invece del placeholder scuro
// generico ignaro del settore.

export interface HeroContent {
  /** URL Unsplash CDN diretto (images.unsplash.com), foto HD verificata. */
  image: string;
  /** Testo alt descrittivo per l'immagine hero. */
  imageAlt: string;
  /** Badge pillola mostrato sopra il titolo, es. "GESTIONE AZIENDALE · RISTORAZIONE". */
  badgeLabel: string;
  /** Parola chiave di settore da evidenziare in corsivo/colore primario nel copy. */
  keyword: string;
  /** Tagline con {keyword} come segnaposto per l'inserimento della parola chiave evidenziata. */
  tagline: string;
}

const HERO_CONTENT: Record<string, HeroContent> = {
  bistromenu: {
    image: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=80',
    imageAlt: 'Tavolo apparecchiato in un ristorante elegante',
    badgeLabel: 'GESTIONE AZIENDALE · RISTORAZIONE',
    keyword: 'ristorante',
    tagline: 'La piattaforma su misura per digitalizzare ogni angolo del tuo {keyword}, dai tavoli agli incassi.',
  },
  recipebook: {
    image: 'https://images.unsplash.com/photo-1556740738-b6a63e27c4df?auto=format&fit=crop&w=1200&q=80',
    imageAlt: 'Piatto gourmet fotografato dall\'alto',
    badgeLabel: 'GESTIONE AZIENDALE · FOOD & RICETTE',
    keyword: 'ricette',
    tagline: 'Organizza e valorizza le tue {keyword}, dagli ingredienti alla presentazione finale.',
  },
  marketnest: {
    image: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1200&q=80',
    imageAlt: 'Interno di un negozio retail con scaffali di prodotti',
    badgeLabel: 'GESTIONE AZIENDALE · RETAIL & E-COMMERCE',
    keyword: 'negozio',
    tagline: 'Tieni sotto controllo prodotti, ordini e clienti del tuo {keyword} in un unico posto.',
  },
  coinpulse: {
    image: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1200&q=80',
    imageAlt: 'Grafici finanziari e schermi di trading',
    badgeLabel: 'GESTIONE AZIENDALE · FINANCE',
    keyword: 'capitale',
    tagline: 'Monitora flussi, transazioni e portafogli: il tuo {keyword} sempre sotto controllo.',
  },
  urbanloft: {
    image: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=1200&q=80',
    imageAlt: 'Interno luminoso di un immobile moderno',
    badgeLabel: 'GESTIONE AZIENDALE · REAL ESTATE',
    keyword: 'immobili',
    tagline: 'Gestisci annunci, visite e contratti dei tuoi {keyword} senza fogli sparsi.',
  },
  volunteerhub: {
    image: 'https://images.unsplash.com/photo-1593113646773-028c64a8f1b8?auto=format&fit=crop&w=1200&q=80',
    imageAlt: 'Gruppo di volontari al lavoro insieme',
    badgeLabel: 'GESTIONE AZIENDALE · NON PROFIT',
    keyword: 'causa',
    tagline: 'Coordina volontari, eventi e donazioni per far crescere la tua {keyword}.',
  },
  cliniclife: {
    image: 'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=1200&q=80',
    imageAlt: 'Medico che visita un paziente in ambulatorio',
    badgeLabel: 'GESTIONE AZIENDALE · SANITÀ',
    keyword: 'pazienti',
    tagline: 'Cartelle, appuntamenti e terapie dei tuoi {keyword}, sempre aggiornati e a norma.',
  },
  docuforge: {
    image: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=80',
    imageAlt: 'Postazione di lavoro con laptop e documentazione tecnica',
    badgeLabel: 'GESTIONE AZIENDALE · DOCUMENTAZIONE',
    keyword: 'documentazione',
    tagline: 'Struttura e pubblica la tua {keyword} tecnica in modo chiaro e sempre accessibile.',
  },
  wandermap: {
    image: 'https://images.unsplash.com/photo-1521791136064-7986c2920216?auto=format&fit=crop&w=1200&q=80',
    imageAlt: 'Mappa e itinerario di viaggio su un tavolo',
    badgeLabel: 'GESTIONE AZIENDALE · TRAVEL & BOOKING',
    keyword: 'prenotazioni',
    tagline: 'Gestisci itinerari, disponibilità e {keyword} in un\'unica piattaforma.',
  },
  'clean-tech': {
    image: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1200&q=80',
    imageAlt: 'Ufficio tech moderno con schermi accesi',
    badgeLabel: 'GESTIONE AZIENDALE · TECH & SAAS',
    keyword: 'prodotto',
    tagline: 'Costruisci, misura e fai crescere il tuo {keyword} con dati sempre a portata di mano.',
  },
  glassmorphism: {
    image: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=80',
    imageAlt: 'Dashboard digitale su schermo moderno',
    badgeLabel: 'GESTIONE AZIENDALE · SOFTWARE',
    keyword: 'workflow',
    tagline: 'Automatizza il tuo {keyword} con un\'interfaccia elegante e moderna.',
  },
  'warm-editorial': {
    image: 'https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?auto=format&fit=crop&w=1200&q=80',
    imageAlt: 'Vetrina di un negozio artigianale',
    badgeLabel: 'GESTIONE AZIENDALE · ARTIGIANATO',
    keyword: 'bottega',
    tagline: 'Racconta e gestisci la tua {keyword}, dai prodotti fatti a mano ai tuoi clienti abituali.',
  },
  'industrial-dark': {
    image: 'https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?auto=format&fit=crop&w=1200&q=80',
    imageAlt: 'Magazzino logistico con scaffalature industriali',
    badgeLabel: 'GESTIONE AZIENDALE · LOGISTICA',
    keyword: 'magazzino',
    tagline: 'Tieni traccia di scorte, spedizioni e fornitori del tuo {keyword} in tempo reale.',
  },
  autodrive: {
    image: 'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?auto=format&fit=crop&w=1600&q=80',
    imageAlt: 'Showroom di un concessionario con auto in esposizione',
    badgeLabel: 'GESTIONE AZIENDALE · AUTOMOTIVE',
    keyword: 'autosalone',
    tagline: 'Gestisci veicoli, appuntamenti e clienti del tuo {keyword} in un\'unica piattaforma.',
  },
};

const DEFAULT_HERO: HeroContent = HERO_CONTENT.wandermap;

export function getHeroContentForDesignKey(designKey: string): HeroContent {
  return HERO_CONTENT[designKey] || DEFAULT_HERO;
}

// ─── Override per settore ────────────────────────────────────────────────
// Alcuni settori condividono la palette/design key di una categoria più ampia
// (es. oculista → cliniclife, stessa palette "sanità") ma meritano
// un'immagine hero davvero specifica invece di quella generica della
// categoria (un ambulatorio oculistico non è genericamente "un medico con un
// paziente"). Va controllato PRIMA del design key.
const SECTOR_HERO_OVERRIDES: Record<string, HeroContent> = {
  oculista: {
    image: 'https://images.unsplash.com/photo-1577401239170-897942555fb3?auto=format&fit=crop&w=1200&q=80',
    imageAlt: 'Esame della vista con strumentazione oculistica',
    badgeLabel: 'GESTIONE AZIENDALE · OTTICA E OCULISTICA',
    keyword: 'pazienti',
    tagline: 'Cartelle, appuntamenti e prescrizioni dei tuoi {keyword}, sempre organizzati.',
  },
};

// Normalizzato come in resolveDesignKey (lib/designTokens.ts): il sector
// generato liberamente può essere "Studio Oculistico", "oculistica", ecc.
function findSectorOverride(sector?: string): HeroContent | null {
  const normalized = (sector || '').toLowerCase().trim();
  if (!normalized) return null;
  for (const [key, hero] of Object.entries(SECTOR_HERO_OVERRIDES)) {
    if (normalized.includes(key)) return hero;
  }
  return null;
}

// Da preferire a getHeroContentForDesignKey nella landing pubblica: prova
// prima l'override specifico di settore, poi cade sul design key (che copre
// già la maggior parte dei casi con un'immagine adeguata).
export function getHeroContentForSector(sector: string | undefined, designKey: string): HeroContent {
  return findSectorOverride(sector) || getHeroContentForDesignKey(designKey);
}
