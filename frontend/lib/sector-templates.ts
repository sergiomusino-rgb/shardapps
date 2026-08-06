// Sector templates for ShardApps PRO
// Core modules + sector-specific modules

export interface FieldTemplate {
  id: string;
  label: string;
  type: 'text' | 'number' | 'currency' | 'date' | 'datetime' | 'boolean' | 'select' | 'textarea' | 'email' | 'phone';
  required?: boolean;
  options?: string[];
}

export interface ModuleTemplate {
  name: string;
  label: string;
  labelPlural: string;
  icon: string;
  fields: FieldTemplate[];
}

export interface SectorTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  modules: ModuleTemplate[];
}

// CORE MODULES - Present in all sectors
const coreModules: ModuleTemplate[] = [
  {
    name: 'clients',
    label: 'Cliente',
    labelPlural: 'Clienti',
    icon: '👥',
    fields: [
      { id: 'nome', label: 'Nome', type: 'text', required: true },
      { id: 'cognome', label: 'Cognome', type: 'text', required: true },
      { id: 'email', label: 'Email', type: 'email' },
      { id: 'telefono', label: 'Telefono', type: 'phone' },
    ],
  },
  {
    name: 'invoices',
    label: 'Fattura',
    labelPlural: 'Fatture',
    icon: '',
    fields: [
      { id: 'numero', label: 'Numero', type: 'text', required: true },
      { id: 'cliente', label: 'Cliente', type: 'text', required: true },
      { id: 'data', label: 'Data', type: 'date', required: true },
      { id: 'importo', label: 'Importo', type: 'currency', required: true },
      { id: 'stato', label: 'Stato', type: 'select', options: ['Bozza', 'Inviata', 'Pagata', 'Scaduta'] },
    ],
  },
];

// SECTOR TEMPLATES
export const SECTOR_TEMPLATES: SectorTemplate[] = [
  {
    id: 'medico',
    name: 'Studio Medico',
    icon: '️',
    description: 'Pazienti, appuntamenti, cartelle cliniche',
    modules: [
      ...coreModules,
      {
        name: 'patients',
        label: 'Paziente',
        labelPlural: 'Pazienti',
        icon: '🩺',
        fields: [
          { id: 'codice_fiscale', label: 'Codice Fiscale', type: 'text', required: true },
          { id: 'data_nascita', label: 'Data di nascita', type: 'date' },
          { id: 'allergie', label: 'Allergie', type: 'textarea' },
          { id: 'gruppo_sanguigno', label: 'Gruppo sanguigno', type: 'select', options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
        ],
      },
      {
        name: 'appointments',
        label: 'Appuntamento',
        labelPlural: 'Appuntamenti',
        icon: '📅',
        fields: [
          { id: 'paziente', label: 'Paziente', type: 'text', required: true },
          { id: 'data_ora', label: 'Data e ora', type: 'datetime', required: true },
          { id: 'durata', label: 'Durata (min)', type: 'number' },
          { id: 'stato', label: 'Stato', type: 'select', options: ['Programmato', 'Confermato', 'Completato', 'Annullato'] },
        ],
      },
      {
        name: 'medical_records',
        label: 'Cartella clinica',
        labelPlural: 'Cartelle cliniche',
        icon: '',
        fields: [
          { id: 'paziente', label: 'Paziente', type: 'text', required: true },
          { id: 'data', label: 'Data', type: 'date', required: true },
          { id: 'diagnosi', label: 'Diagnosi', type: 'textarea' },
          { id: 'terapia', label: 'Terapia', type: 'textarea' },
        ],
      },
    ],
  },
  {
    id: 'ristorazione',
    name: 'Ristorante',
    icon: '🍽️',
    description: 'Tavoli, menu, ordini, ingredienti',
    modules: [
      ...coreModules,
      {
        name: 'tables',
        label: 'Tavolo',
        labelPlural: 'Tavoli',
        icon: '🪑',
        fields: [
          { id: 'numero', label: 'Numero', type: 'number', required: true },
          { id: 'posti', label: 'Posti', type: 'number', required: true },
          { id: 'zona', label: 'Zona', type: 'select', options: ['Interno', 'Esterno'] },
          { id: 'stato', label: 'Stato', type: 'select', options: ['Libero', 'Occupato', 'Prenotato'] },
        ],
      },
      {
        name: 'menu_items',
        label: 'Piatto',
        labelPlural: 'Menu',
        icon: '🍝',
        fields: [
          { id: 'nome', label: 'Nome', type: 'text', required: true },
          { id: 'categoria', label: 'Categoria', type: 'select', options: ['Antipasto', 'Primo', 'Secondo', 'Dolce'] },
          { id: 'prezzo', label: 'Prezzo', type: 'currency', required: true },
          { id: 'allergeni', label: 'Allergeni', type: 'textarea' },
        ],
      },
      {
        name: 'orders',
        label: 'Ordine',
        labelPlural: 'Ordini',
        icon: '🛒',
        fields: [
          { id: 'tavolo', label: 'Tavolo', type: 'text', required: true },
          { id: 'piatti', label: 'Piatti', type: 'textarea', required: true },
          { id: 'totale', label: 'Totale', type: 'currency' },
          { id: 'stato', label: 'Stato', type: 'select', options: ['In preparazione', 'Pronto', 'Servito'] },
        ],
      },
    ],
  },
  {
    id: 'retail',
    name: 'Negozio',
    icon: '️',
    description: 'Prodotti, vendite, magazzino',
    modules: [
      ...coreModules,
      {
        name: 'products',
        label: 'Prodotto',
        labelPlural: 'Prodotti',
        icon: '📦',
        fields: [
          { id: 'codice', label: 'Codice', type: 'text', required: true },
          { id: 'nome', label: 'Nome', type: 'text', required: true },
          { id: 'prezzo', label: 'Prezzo', type: 'currency', required: true },
          { id: 'giacenza', label: 'Giacenza', type: 'number' },
          { id: 'barcode', label: 'Barcode', type: 'text' },
        ],
      },
      {
        name: 'sales',
        label: 'Vendita',
        labelPlural: 'Vendite',
        icon: '💵',
        fields: [
          { id: 'numero', label: 'Scontrino', type: 'text', required: true },
          { id: 'prodotti', label: 'Prodotti', type: 'textarea', required: true },
          { id: 'totale', label: 'Totale', type: 'currency', required: true },
          { id: 'pagamento', label: 'Pagamento', type: 'select', options: ['Contanti', 'Carta'] },
        ],
      },
    ],
  },
  {
    id: 'officina',
    name: 'Officina',
    icon: '🔧',
    description: 'Veicoli, interventi, ricambi',
    modules: [
      ...coreModules,
      {
        name: 'vehicles',
        label: 'Veicolo',
        labelPlural: 'Veicoli',
        icon: '🚗',
        fields: [
          { id: 'targa', label: 'Targa', type: 'text', required: true },
          { id: 'marca', label: 'Marca', type: 'text', required: true },
          { id: 'modello', label: 'Modello', type: 'text' },
          { id: 'km', label: 'Chilometri', type: 'number' },
        ],
      },
      {
        name: 'interventions',
        label: 'Intervento',
        labelPlural: 'Interventi',
        icon: '🛠️',
        fields: [
          { id: 'veicolo', label: 'Veicolo', type: 'text', required: true },
          { id: 'descrizione', label: 'Lavoro', type: 'textarea', required: true },
          { id: 'ore', label: 'Ore', type: 'number' },
          { id: 'stato', label: 'Stato', type: 'select', options: ['In attesa', 'In lavorazione', 'Completato'] },
        ],
      },
      {
        name: 'spare_parts',
        label: 'Ricambio',
        labelPlural: 'Ricambi',
        icon: '⚙️',
        fields: [
          { id: 'codice', label: 'Codice', type: 'text', required: true },
          { id: 'nome', label: 'Nome', type: 'text', required: true },
          { id: 'prezzo', label: 'Prezzo', type: 'currency' },
          { id: 'giacenza', label: 'Disponibilità', type: 'number' },
        ],
      },
    ],
  },
];

export function getSectorTemplate(sectorId: string): SectorTemplate | undefined {
  return SECTOR_TEMPLATES.find(s => s.id === sectorId);
}

export function generateSchemaFromSector(sectorId: string) {
  const template = getSectorTemplate(sectorId);
  if (!template) return null;

  return {
    tables: template.modules.map(m => ({
      name: m.name,
      label: m.label,
      labelPlural: m.labelPlural,
      icon: m.icon,
      fields: m.fields.map(f => ({
        id: f.id,
        label: f.label,
        type: f.type,
        required: f.required || false,
        options: f.options || [],
      })),
    })),
  };
}
