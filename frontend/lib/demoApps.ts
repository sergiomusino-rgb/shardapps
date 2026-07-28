// Demo dello Showcase (dashboard/showcase): non sono app reali generate dagli
// utenti, quindi non esistono righe corrispondenti nella tabella `apps` — per
// questo /a/[slug]/layout.tsx le riconosce per slug e costruisce l'AppInfo
// localmente invece di interrogare Supabase, mostrando comunque la landing
// page pubblica reale (LandingPublic in /a/[slug]/page.tsx).
//
// Le tabelle includono anche `fields` (stessa forma di FieldDef in
// app/a/[slug]/app/table-definitions.ts, duplicata qui senza import per non
// accoppiare lib/ a una cartella di route): senza campi, aprire una tabella
// demo dietro login manda in crash il motore dati dinamico (si aspetta
// sempre fields.map(...)), che è pensato per gli schemi reali del Creator.

export interface DemoField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'email' | 'tel' | 'date' | 'datetime' | 'select' | 'multiselect'
    | 'textarea' | 'checkbox' | 'currency' | 'image' | 'file' | 'relation';
  required?: boolean;
  options?: string[];
}

export interface DemoAppTable {
  name: string;
  label: string;
  labelPlural: string;
  icon?: string;
  color?: string;
  fields: DemoField[];
}

export interface DemoApp {
  slug: string;
  name: string;
  sector: string;
  appType: string;
  description: string;
  tables: DemoAppTable[];
}

export const DEMO_APPS: DemoApp[] = [
  {
    slug: 'demo-ristorante',
    name: 'Ristorante La Piazza',
    sector: 'ristorante',
    appType: 'Ristorante',
    description: 'Gestione tavoli, menu, ordini e cucina in tempo reale',
    tables: [
      {
        name: 'tavoli', label: 'Tavolo', labelPlural: 'Tavoli', color: '#6366f1',
        fields: [
          { name: 'numero', label: 'Numero', type: 'text', required: true },
          { name: 'posti', label: 'Posti', type: 'number' },
          { name: 'zona', label: 'Zona', type: 'select', options: ['Interno', 'Esterno', 'Dehors'] },
          { name: 'stato', label: 'Stato', type: 'select', options: ['Libero', 'Occupato', 'Prenotato'] },
        ],
      },
      {
        name: 'menu', label: 'Piatto', labelPlural: 'Menu', color: '#f59e0b',
        fields: [
          { name: 'nome_piatto', label: 'Nome Piatto', type: 'text', required: true },
          { name: 'categoria', label: 'Categoria', type: 'select', options: ['Antipasti', 'Primi', 'Secondi', 'Dolci', 'Bevande'] },
          { name: 'prezzo', label: 'Prezzo', type: 'currency' },
          { name: 'disponibile', label: 'Disponibile', type: 'checkbox' },
        ],
      },
      {
        name: 'ordini', label: 'Ordine', labelPlural: 'Ordini', color: '#22c55e',
        fields: [
          { name: 'tavolo', label: 'Tavolo', type: 'text', required: true },
          { name: 'totale', label: 'Totale', type: 'currency' },
          { name: 'stato', label: 'Stato', type: 'select', options: ['In preparazione', 'Pronto', 'Servito', 'Pagato'] },
          { name: 'data', label: 'Data', type: 'date' },
        ],
      },
    ],
  },
  {
    slug: 'demo-studio-medico',
    name: 'Studio Medico Bianchi',
    sector: 'studio medico',
    appType: 'Medico',
    description: 'Pazienti, appuntamenti e cartelle cliniche digitali',
    tables: [
      {
        name: 'pazienti', label: 'Paziente', labelPlural: 'Pazienti', color: '#6366f1',
        fields: [
          { name: 'nome_cognome', label: 'Nome e Cognome', type: 'text', required: true },
          { name: 'data_nascita', label: 'Data di Nascita', type: 'date' },
          { name: 'telefono', label: 'Telefono', type: 'tel' },
          { name: 'email', label: 'Email', type: 'email' },
        ],
      },
      {
        name: 'appuntamenti', label: 'Appuntamento', labelPlural: 'Appuntamenti', color: '#06b6d4',
        fields: [
          { name: 'paziente', label: 'Paziente', type: 'text', required: true },
          { name: 'data', label: 'Data', type: 'date' },
          { name: 'ora', label: 'Ora', type: 'text' },
          { name: 'tipo_visita', label: 'Tipo Visita', type: 'select', options: ['Visita generale', 'Controllo', 'Urgenza'] },
          { name: 'stato', label: 'Stato', type: 'select', options: ['Confermato', 'In attesa', 'Annullato'] },
        ],
      },
      {
        name: 'visite', label: 'Visita', labelPlural: 'Cartelle Cliniche', color: '#8b5cf6',
        fields: [
          { name: 'paziente', label: 'Paziente', type: 'text', required: true },
          { name: 'data', label: 'Data', type: 'date' },
          { name: 'diagnosi', label: 'Diagnosi', type: 'textarea' },
          { name: 'terapia', label: 'Terapia', type: 'textarea' },
        ],
      },
    ],
  },
  {
    slug: 'demo-officina',
    name: 'Officina Rossi',
    sector: 'officina',
    appType: 'Officina',
    description: 'Veicoli, interventi, ricambi e fatturazione',
    tables: [
      {
        name: 'veicoli', label: 'Veicolo', labelPlural: 'Veicoli', color: '#6366f1',
        fields: [
          { name: 'targa', label: 'Targa', type: 'text', required: true },
          { name: 'modello', label: 'Modello', type: 'text' },
          { name: 'proprietario', label: 'Proprietario', type: 'text' },
          { name: 'anno', label: 'Anno', type: 'number' },
        ],
      },
      {
        name: 'interventi', label: 'Intervento', labelPlural: 'Interventi', color: '#f59e0b',
        fields: [
          { name: 'veicolo', label: 'Veicolo', type: 'text', required: true },
          { name: 'tipo_intervento', label: 'Tipo Intervento', type: 'text' },
          { name: 'data', label: 'Data', type: 'date' },
          { name: 'costo', label: 'Costo', type: 'currency' },
          { name: 'stato', label: 'Stato', type: 'select', options: ['In corso', 'Completato'] },
        ],
      },
      {
        name: 'fatture', label: 'Fattura', labelPlural: 'Fatturazione', color: '#22c55e',
        fields: [
          { name: 'numero', label: 'Numero', type: 'text', required: true },
          { name: 'cliente', label: 'Cliente', type: 'text' },
          { name: 'importo', label: 'Importo', type: 'currency' },
          { name: 'data', label: 'Data', type: 'date' },
          { name: 'pagata', label: 'Pagata', type: 'checkbox' },
        ],
      },
    ],
  },
  {
    slug: 'demo-hotel',
    name: 'Hotel Mediterraneo',
    sector: 'hotel',
    appType: 'Hotel',
    description: 'Camere, prenotazioni, ospiti e housekeeping',
    tables: [
      {
        name: 'camere', label: 'Camera', labelPlural: 'Camere', color: '#6366f1',
        fields: [
          { name: 'numero', label: 'Numero', type: 'text', required: true },
          { name: 'tipo', label: 'Tipo', type: 'select', options: ['Singola', 'Doppia', 'Suite'] },
          { name: 'piano', label: 'Piano', type: 'number' },
          { name: 'stato', label: 'Stato', type: 'select', options: ['Libera', 'Occupata', 'Pulizie'] },
        ],
      },
      {
        name: 'prenotazioni', label: 'Prenotazione', labelPlural: 'Prenotazioni', color: '#06b6d4',
        fields: [
          { name: 'ospite', label: 'Ospite', type: 'text', required: true },
          { name: 'check_in', label: 'Check-in', type: 'date' },
          { name: 'check_out', label: 'Check-out', type: 'date' },
          { name: 'camera', label: 'Camera', type: 'text' },
          { name: 'stato', label: 'Stato', type: 'select', options: ['Confermata', 'In attesa', 'Cancellata'] },
        ],
      },
      {
        name: 'ospiti', label: 'Ospite', labelPlural: 'Ospiti', color: '#8b5cf6',
        fields: [
          { name: 'nome_cognome', label: 'Nome e Cognome', type: 'text', required: true },
          { name: 'email', label: 'Email', type: 'email' },
          { name: 'telefono', label: 'Telefono', type: 'tel' },
          { name: 'documento', label: 'Documento', type: 'text' },
        ],
      },
    ],
  },
  {
    slug: 'demo-palestra',
    name: 'Palestra FitLab',
    sector: 'palestra',
    appType: 'Palestra',
    description: 'Iscritti, abbonamenti, schede e presenze',
    tables: [
      {
        name: 'iscritti', label: 'Iscritto', labelPlural: 'Iscritti', color: '#6366f1',
        fields: [
          { name: 'nome_cognome', label: 'Nome e Cognome', type: 'text', required: true },
          { name: 'email', label: 'Email', type: 'email' },
          { name: 'telefono', label: 'Telefono', type: 'tel' },
          { name: 'data_iscrizione', label: 'Data Iscrizione', type: 'date' },
        ],
      },
      {
        name: 'abbonamenti', label: 'Abbonamento', labelPlural: 'Abbonamenti', color: '#f59e0b',
        fields: [
          { name: 'iscritto', label: 'Iscritto', type: 'text', required: true },
          { name: 'tipo', label: 'Tipo', type: 'select', options: ['Mensile', 'Trimestrale', 'Annuale'] },
          { name: 'scadenza', label: 'Scadenza', type: 'date' },
          { name: 'attivo', label: 'Attivo', type: 'checkbox' },
        ],
      },
      {
        name: 'presenze', label: 'Presenza', labelPlural: 'Presenze', color: '#22c55e',
        fields: [
          { name: 'iscritto', label: 'Iscritto', type: 'text', required: true },
          { name: 'data', label: 'Data', type: 'date' },
          { name: 'ora_ingresso', label: 'Ora Ingresso', type: 'text' },
          { name: 'attivita', label: 'Attività', type: 'select', options: ['Sala pesi', 'Corsi', 'Piscina'] },
        ],
      },
    ],
  },
  {
    slug: 'demo-negozio',
    name: 'Negozio Moda & Co.',
    sector: 'negozio',
    appType: 'Negozio',
    description: 'Prodotti, vendite, magazzino e fornitori',
    tables: [
      {
        name: 'prodotti', label: 'Prodotto', labelPlural: 'Prodotti', color: '#6366f1',
        fields: [
          { name: 'nome', label: 'Nome', type: 'text', required: true },
          { name: 'categoria', label: 'Categoria', type: 'select', options: ['Abbigliamento', 'Accessori', 'Scarpe'] },
          { name: 'prezzo', label: 'Prezzo', type: 'currency' },
          { name: 'taglia', label: 'Taglia', type: 'select', options: ['XS', 'S', 'M', 'L', 'XL'] },
        ],
      },
      {
        name: 'magazzino', label: 'Voce Magazzino', labelPlural: 'Magazzino', color: '#f59e0b',
        fields: [
          { name: 'prodotto', label: 'Prodotto', type: 'text', required: true },
          { name: 'quantita', label: 'Quantità', type: 'number' },
          { name: 'ubicazione', label: 'Ubicazione', type: 'text' },
          { name: 'soglia_minima', label: 'Soglia Minima', type: 'number' },
        ],
      },
      {
        name: 'fornitori', label: 'Fornitore', labelPlural: 'Fornitori', color: '#8b5cf6',
        fields: [
          { name: 'ragione_sociale', label: 'Ragione Sociale', type: 'text', required: true },
          { name: 'contatto', label: 'Contatto', type: 'text' },
          { name: 'email', label: 'Email', type: 'email' },
          { name: 'telefono', label: 'Telefono', type: 'tel' },
        ],
      },
    ],
  },
];

export function getDemoApp(slug: string): DemoApp | undefined {
  return DEMO_APPS.find((a) => a.slug === slug);
}
