/**
 * ─── Semantic Field Layer (CreatorAI V3) ────────────────────────────────────
 *
 * Livello semantico condiviso, language-independent, alla base di
 * mockDataGenerator.ts (demo data) e table-definitions.ts (selezione colonna
 * "titolo"/prezzo per le viste record). Sostituisce la logica precedente
 * (CreatorAI v2), che riconosceva SOLO nomi campo in italiano — un blueprint
 * generato in inglese (full_name, price, unit_price, start_date...) cadeva
 * quasi sempre sul fallback generico (residuo #1 del benchmark v2, issue
 * GitHub #39).
 *
 * Modello concettuale (V3, sezione 1-2 della spec):
 *
 *   field name -> semantic concept -> semantic role -> data strategy
 *
 * Questo modulo si ferma al secondo passaggio (concept + role): la "data
 * strategy" vera e propria (quale generatore usare, con quali dipendenze fra
 * campi) resta responsabilità del chiamante (mockDataGenerator.ts), che
 * conosce il contesto del record — qui c'è SOLO classificazione, nessun
 * generatore di valori, nessuno stato.
 *
 * Non implementiamo "centinaia di categorie" (esplicitamente sconsigliato
 * dalla spec V3): solo i concetti necessari a risolvere i 3 problemi noti
 * della v2 (lingua, collisioni di fallback, date semanticamente vuote) più
 * quelli già gestiti dalla v2 (mai un downgrade). Estendibile: aggiungere un
 * concetto è aggiungere una entry a CONCEPT_RULES, nessun altro file da
 * toccare per il riconoscimento in sé (i chiamanti che vogliono reagire a un
 * nuovo concetto vanno comunque aggiornati, ma il matching resta qui).
 *
 * Posizione (frontend/lib/, non frontend/src/lib/): stesso alias "@/lib/..."
 * già usato da tutti i moduli client dell'app gestionale (es.
 * recordPlaceholderImages.ts) — mockDataGenerator.ts/table-definitions.ts/
 * DynamicDataTable.tsx/RecordCardGrid.tsx/cellRenderers.tsx lo importano
 * tutti così, nessun nuovo alias da introdurre.
 */

export type SemanticRole = 'identity' | 'temporal' | 'numeric' | 'financial' | 'workflow' | 'text';

export type SemanticConcept =
  // Identity
  | 'person_name' | 'company_name' | 'email' | 'phone' | 'address' | 'city'
  // Temporal
  | 'date_start' | 'date_end' | 'date_deadline' | 'date_created' | 'date_updated' | 'date_birth' | 'date_generic'
  // Numeric (non finanziario)
  | 'quantity' | 'duration' | 'rate' | 'percentage' | 'year' | 'distance' | 'score'
  // Financial
  | 'unit_price' | 'subtotal' | 'tax' | 'discount' | 'labor_cost' | 'material_cost' | 'total_cost' | 'revenue' | 'margin' | 'currency_generic'
  // Workflow
  | 'status' | 'priority' | 'stage'
  // Testo "di dominio" (già gestiti dalla v1.1/v2, qui solo riclassificati)
  | 'notes' | 'description' | 'title' | 'product_name' | 'plate'
  | 'unknown';

const ROLE_BY_CONCEPT: Record<SemanticConcept, SemanticRole> = {
  person_name: 'identity', company_name: 'identity', email: 'identity', phone: 'identity', address: 'identity', city: 'identity',
  date_start: 'temporal', date_end: 'temporal', date_deadline: 'temporal', date_created: 'temporal', date_updated: 'temporal', date_birth: 'temporal', date_generic: 'temporal',
  quantity: 'numeric', duration: 'numeric', rate: 'numeric', percentage: 'numeric', year: 'numeric', distance: 'numeric', score: 'numeric',
  unit_price: 'financial', subtotal: 'financial', tax: 'financial', discount: 'financial', labor_cost: 'financial', material_cost: 'financial', total_cost: 'financial', revenue: 'financial', margin: 'financial', currency_generic: 'financial',
  status: 'workflow', priority: 'workflow', stage: 'workflow',
  notes: 'text', description: 'text', title: 'text', product_name: 'text', plate: 'text',
  unknown: 'text',
};

export function semanticRole(concept: SemanticConcept): SemanticRole {
  return ROLE_BY_CONCEPT[concept];
}

/** Normalizza per il matching: minuscolo, senza accenti — stessa funzione già
 * usata in mockDataGenerator.ts (duplicata qui volutamente: questo modulo
 * deve restare senza dipendenze, importabile sia lato client tabelle che lato
 * server orchestrator/validator). */
export function normalizeFieldName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Spezza un nome campo normalizzato nei suoi "token" (separati da
 * underscore/spazi/altri non-alfanumerici) e li rigiunge con uno spazio —
 * stesso concetto di tokens() già in mockDataGenerator.ts (v1.1/v2), qui
 * usato per dare ai pattern REGEX un vero confine di parola (\b) anche sugli
 * id composti tipici dei blueprint AI: "nome_lead" -> "nome lead" (così
 * \bnome\b matcha), mentre un token ambiguo come "nomenclatura" resta un
 * blocco unico e NON matcha \bnome\b (nessun falso positivo). Necessario
 * perché "_" è un carattere di parola per \b in JS — un pattern \bnome\b
 * applicato direttamente alla stringa con underscore non avrebbe mai un
 * confine tra "nome" e "_lead". */
function tokenizedForMatch(fieldId: string): string {
  return normalizeFieldName(fieldId).split(/[^a-z0-9]+/).filter(Boolean).join(' ');
}

/**
 * Regole di classificazione, in ORDINE DI PRIORITÀ (la prima che matcha
 * vince) — stesso principio già in uso da classifyNumberField/il ramo
 * "default" di generateFieldValue in v2, qui riunito in un unico posto e con
 * pattern IT+EN combinati per ogni concetto. L'ordine conta: i pattern più
 * specifici precedono quelli generici — es. "product_name"/"nome_prodotto"
 * precede "person_name"/"nome" (altrimenti "nome_prodotto" verrebbe letto
 * come un nome proprio), "rate"/"tariffa" precede "unit_price"/"prezzo"
 * generico ("prezzo_orario" deve restare una TARIFFA, non un prezzo
 * unitario). Tutte le regole operano sulla forma tokenizzata
 * (tokenizedForMatch): i pattern brevi/ambigui usano \b, quelli composti
 * restano substring match (già sicuri di per sé, es. "ragione.?social").
 */
const CONCEPT_RULES: Array<{ concept: SemanticConcept; test: RegExp }> = [
  // ── Identity / testo di dominio con priorità sui pattern "nome"-generici ──
  { concept: 'company_name', test: /ragione.?social|azienda|societ|impresa|fornitore|company|business.?name|vendor|supplier/ },
  { concept: 'product_name', test: /nome.?prodotto|codice.?articolo|\barticolo\b|\bmodello\b|product.?name|item.?name/ },
  { concept: 'email', test: /email|posta.?elettronica|e.?mail/ },
  { concept: 'phone', test: /telefon|cellulare|\btel\b|phone|mobile|\bcell\b/ },
  { concept: 'address', test: /indirizzo|\bvia\b|address|street/ },
  { concept: 'city', test: /citt|comune|\bcity\b|\btown\b/ },
  { concept: 'person_name', test: /cognome|\bnome\b|nominativo|\bcliente\b|titolare|referente|\bcontatto\b|full.?name|first.?name|last.?name|surname|member.?name|customer.?name|contact.?name/ },
  // ── Temporal (l'ordine qui è cruciale: deadline/scadenza prima di "end"
  // generico, nascita prima di "start" generico) ──
  { concept: 'date_birth', test: /data.?nascita|birth.?date|date.?of.?birth|\bdob\b/ },
  { concept: 'date_deadline', test: /scaden|deadline|expir|due.?date/ },
  { concept: 'date_created', test: /data.?creazione|data.?apertura|created.?at|creation.?date|opened.?at|join.?date|data.?iscrizione/ },
  { concept: 'date_updated', test: /data.?aggiornamento|data.?modifica|updated.?at|last.?modified|modified.?at/ },
  { concept: 'date_end', test: /data.?fine|data.?termine|data.?chiusura|end.?date|finish.?date/ },
  { concept: 'date_start', test: /data.?inizio|start.?date|begin.?date/ },
  { concept: 'date_generic', test: /\bdata\b|\bdate\b/ },
  // ── Financial (ordine: le combinazioni più specifiche prima dei generici
  // "costo"/"prezzo"/"cost"/"price") ──
  { concept: 'labor_cost', test: /costo.?manodopera|manodopera|labor.?cost|labour.?cost/ },
  { concept: 'material_cost', test: /costo.?material|material.?cost/ },
  { concept: 'total_cost', test: /costo.?totale|totale.?costo|importo.?totale|prezzo.?totale|total.?cost|grand.?total|\btotale\b|\btotal\b/ },
  { concept: 'subtotal', test: /subtotal|sub.?totale/ },
  { concept: 'rate', test: /tariffa|costo.?orario|prezzo.?orario|hourly.?rate|\brate\b/ },
  { concept: 'unit_price', test: /prezzo.?unitario|unit.?price|prezzo.?vendita|prezzo(?!.?acquist)|\bprice\b|selling.?price/ },
  { concept: 'tax', test: /\biva\b|\btax\b|\bvat\b/ },
  { concept: 'discount', test: /sconto|discount/ },
  { concept: 'revenue', test: /ricavo|fatturato|entrat|revenue|income/ },
  { concept: 'margin', test: /margine|margin|profit/ },
  { concept: 'percentage', test: /percentual|\bperc\b|percentage|\bpct\b/ },
  // ── Numeric (non finanziario) ──
  { concept: 'score', test: /punteggio|\bscore\b|\brating\b|\bvoto\b/ },
  { concept: 'year', test: /\banno\b|\byear\b/ },
  { concept: 'distance', test: /\bkm\b|chilometra|distance|mileage/ },
  { concept: 'quantity', test: /quantit|\bqta\b|quantity|\bqty\b/ },
  { concept: 'duration', test: /\bore\b|ore.?lavorate|numero.?ore|durata|hours.?worked|\bhours\b|duration/ },
  // Fallback finanziario generico: qualunque altro campo "di valuta" non
  // riconosciuto sopra (canone, importo, valore, cost, amount...).
  { concept: 'currency_generic', test: /\bcosto\b|\bcost\b|\bprezzo\b|importo|valore|canone|amount|\bfee\b/ },
  // ── Workflow ──
  { concept: 'status', test: /\bstato\b|\bstatus\b|\bstate\b/ },
  { concept: 'priority', test: /priorit|priority/ },
  { concept: 'stage', test: /\bfase\b|\bstage\b|pipeline.?stage/ },
  // ── Testo di dominio residuo ──
  { concept: 'plate', test: /targa|license.?plate|number.?plate/ },
  { concept: 'notes', test: /note|annotazion|\bnotes\b/ },
  { concept: 'description', test: /descrizion|description/ },
  { concept: 'title', test: /titolo|oggetto|\btitle\b|\bsubject\b/ },
];

/**
 * Classifica un nome campo (grezzo, non serve pre-normalizzarlo) nel
 * concetto semantico più specifico che matcha. Pura, deterministica, nessuna
 * dipendenza dal tipo dichiarato del campo (lo stesso nome "prezzo"/"price"
 * può comparire su un campo number, currency o persino text scritto male dal
 * modello — la classificazione del NOME è la stessa in tutti i casi, è il
 * chiamante a decidere come usarla per il tipo dato).
 */
export function classifyFieldConcept(fieldId: string): SemanticConcept {
  const fn = tokenizedForMatch(fieldId);
  for (const rule of CONCEPT_RULES) {
    if (rule.test.test(fn)) return rule.concept;
  }
  return 'unknown';
}

/** True se il concetto rappresenta un valore monetario/di costo (usato per
 * decidere se formattare un numero come valuta — sostituisce i regex
 * Italian-only "prezzo|costo|totale|importo" sparsi in cellRenderers.tsx/
 * RecordCardGrid.tsx/table-definitions.ts::findDisplayPriceField). */
export function isFinancialConcept(concept: SemanticConcept): boolean {
  return semanticRole(concept) === 'financial';
}
