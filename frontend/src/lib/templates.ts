// ─── Template Verticali (Creator AI) ────────────────────────────────────────
// Preset di settore selezionabili nella Dashboard prima del prompt libero:
// l'utente sceglie un template, compila 3-4 campi essenziali nella quick
// modal, e il prompt finale inviato a /api/creator/generate viene composto
// unendo il systemPromptTemplate del preset (specifica di tabelle/feature)
// con le variabili inserite. Il campo `sector` guida sia il design system
// (vedi lib/designTokens.ts) sia il layout dell'app generata.

export interface QuickField {
  id: 'businessName' | 'phone' | 'color' | 'address';
  label: string;
  placeholder: string;
  type: 'text' | 'tel' | 'color';
  required: boolean;
}

export interface VerticalTemplate {
  id: string;
  icon: string;
  name: string;
  description: string;
  /** Valore riconosciuto da SECTOR_TO_DESIGN_KEY (designTokens.ts): determina
   * tema colori e layout dell'app generata. */
  sector: string;
  /** Bullet list mostrata sulla card del template. */
  features: string[];
  /** Prompt pre-ottimizzato per il modello, con placeholder {{variabile}}
   * sostituiti dai valori inseriti nella quick modal. */
  systemPromptTemplate: string;
}

// Campi richiesti nella quick modal: condivisi da tutti i template (stessa
// struttura richiesta nella spec: Nome Attività, WhatsApp/Tel, Colore,
// Città/Indirizzo).
export const QUICK_FIELDS: QuickField[] = [
  { id: 'businessName', label: 'Nome Attività', placeholder: 'Es. Pizzeria da Mario', type: 'text', required: true },
  { id: 'phone', label: 'WhatsApp / Telefono', placeholder: 'Es. +39 333 1234567', type: 'tel', required: true },
  { id: 'color', label: 'Colore', placeholder: '#f97316', type: 'color', required: false },
  { id: 'address', label: 'Città / Indirizzo', placeholder: 'Es. Via Roma 1, Milano', type: 'text', required: false },
];

export type QuickFieldValues = Partial<Record<QuickField['id'], string>>;

export const VERTICAL_TEMPLATES: VerticalTemplate[] = [
  {
    id: 'pizzeria-asporto',
    icon: '🍕',
    name: 'Pizzeria & Asporto',
    description: 'Menu digitale, ordini d\'asporto via WhatsApp e prenotazione tavoli.',
    sector: 'food',
    features: ['Menu', "Ordine d'asporto via WhatsApp", 'Prenotazione tavolo'],
    systemPromptTemplate: `Crea un'app gestionale per l'attività di ristorazione/asporto "{{businessName}}", situata in {{address}}.
Includi obbligatoriamente queste tabelle:
1. "Menu" - piatti/pizze con nome, descrizione, categoria, ingredienti, prezzo, disponibilità.
2. "Ordini" - ordini d'asporto con cliente, telefono di contatto (WhatsApp {{phone}}), lista piatti ordinati, totale, stato (Ricevuto, In preparazione, Pronto per il ritiro, Consegnato, Annullato), note.
3. "Prenotazioni Tavolo" - prenotazione con nome cliente, telefono, data, ora, numero coperti, stato (Confermata, In attesa, Annullata), note.
Il colore principale del brand è {{color}}.`,
  },
  {
    id: 'personal-trainer-fitness',
    icon: '🏋️',
    name: 'Personal Trainer & Fitness',
    description: 'Schede corsi, tracciamento progressi clienti e form di contatto.',
    // 'health' -> design system cliniclife: energico e pulito, adatto a
    // percorsi di benessere/fitness (non esiste un design key dedicato).
    sector: 'health',
    features: ['Scheda corsi', 'Tracciamento progressi', 'Form contatto'],
    systemPromptTemplate: `Crea un'app gestionale per il personal trainer/centro fitness "{{businessName}}", situato in {{address}}.
Includi obbligatoriamente queste tabelle:
1. "Corsi" - schede corso con nome, descrizione, livello (Base, Intermedio, Avanzato), durata, giorni/orari, posti disponibili.
2. "Clienti" - anagrafica cliente con nome, telefono di contatto ({{phone}}), obiettivo, note mediche.
3. "Progressi" - tracciamento con cliente collegato, data misurazione, peso, percentuale massa grassa, note allenamento.
4. "Richieste Contatto" - form contatto con nome, telefono, messaggio, stato (Nuova, Contattato, Chiuso).
Il colore principale del brand è {{color}}.`,
  },
  {
    id: 'saloni-parrucchieri',
    icon: '✂️',
    name: 'Saloni & Parrucchieri',
    description: 'Listino servizi, booking appuntamenti e gestione orari.',
    // 'boutique' -> design system marketnest (retail/boutique elegante), la
    // scelta più vicina disponibile per un salone di bellezza.
    sector: 'boutique',
    features: ['Listino servizi', 'Booking appuntamento', 'Orari'],
    systemPromptTemplate: `Crea un'app gestionale per il salone/parrucchiere "{{businessName}}", situato in {{address}}.
Includi obbligatoriamente queste tabelle:
1. "Servizi" - listino servizi con nome, descrizione, durata (minuti), prezzo.
2. "Appuntamenti" - booking con cliente, telefono di contatto ({{phone}}), servizio collegato, data, ora, operatore, stato (Confermato, In attesa, Completato, Annullato).
3. "Orari Apertura" - orari settimanali con giorno, ora apertura, ora chiusura, chiuso (si/no).
Il colore principale del brand è {{color}}.`,
  },
  {
    id: 'consulenti-artigiani',
    icon: '💼',
    name: 'Consulenti & Artigiani',
    description: 'Qualificazione lead, calcolatore preventivo e contatti.',
    sector: 'saas',
    features: ['Form qualificazione lead', 'Calcolatore preventivo', 'Contatti'],
    systemPromptTemplate: `Crea un'app gestionale per il consulente/artigiano "{{businessName}}", situato in {{address}}.
Includi obbligatoriamente queste tabelle:
1. "Lead" - form di qualificazione con nome, telefono di contatto ({{phone}}), tipo di richiesta, budget indicativo, stato (Nuovo, Qualificato, Preventivo inviato, Chiuso vinto, Chiuso perso).
2. "Preventivi" - calcolatore preventivo con lead collegato, descrizione lavoro, ore stimate, tariffa oraria, totale calcolato, stato (Bozza, Inviato, Accettato, Rifiutato).
3. "Contatti" - rubrica clienti/fornitori con nome, telefono, email, note.
Il colore principale del brand è {{color}}.`,
  },
];

/** Sostituisce i placeholder {{variabile}} nel systemPromptTemplate con i
 * valori inseriti nella quick modal. Placeholder senza valore diventano
 * stringa vuota invece di restare visibili nel prompt finale. */
export function buildTemplatePrompt(template: VerticalTemplate, values: QuickFieldValues): string {
  return template.systemPromptTemplate.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    return values[key as QuickField['id']]?.trim() || '';
  });
}

export function getTemplateById(id: string): VerticalTemplate | undefined {
  return VERTICAL_TEMPLATES.find((t) => t.id === id);
}
