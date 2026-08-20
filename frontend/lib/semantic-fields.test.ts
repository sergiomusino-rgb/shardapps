// ─── Test isolati — CreatorAI V3, livello semantico language-independent ───
// node:test nativo, nessuna dipendenza esterna (semantic-fields.ts non
// importa nulla, testabile direttamente senza il loader di alias).
//
// Uso: node --test "lib/semantic-fields.test.ts" (da frontend/).

import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFieldConcept, semanticRole, isFinancialConcept, isTerminalStateValue } from './semantic-fields.ts';

// ═══════════════════════════════════════════════════════════════════════════
// Sezione 1/3 della spec V3: la semantica NON deve dipendere dalla lingua
// del campo — IT ed EN equivalenti devono produrre lo STESSO concetto.
// ═══════════════════════════════════════════════════════════════════════════

const EQUIVALENT_PAIRS: Array<[string, string]> = [
  ['nome', 'full_name'],
  ['cognome', 'last_name'],
  ['telefono', 'phone'],
  ['email', 'email'],
  ['indirizzo', 'address'],
  ['citta', 'city'],
  ['ragione_sociale', 'company_name'],
  ['prezzo', 'price'],
  ['prezzo_unitario', 'unit_price'],
  ['subtotale', 'subtotal'],
  ['costo_totale', 'total_cost'],
  ['costo_manodopera', 'labor_cost'],
  ['costo_materiali', 'material_cost'],
  ['sconto', 'discount'],
  ['iva', 'tax'],
  ['ricavo', 'revenue'],
  ['margine', 'margin'],
  ['quantita', 'quantity'],
  ['ore_lavorate', 'hours_worked'],
  ['tariffa_oraria', 'hourly_rate'],
  ['data_inizio', 'start_date'],
  ['data_scadenza', 'expiry_date'],
  ['data_creazione', 'created_at'],
  ['stato', 'status'],
  ['note', 'notes'],
  ['descrizione', 'description'],
];

for (const [it, en] of EQUIVALENT_PAIRS) {
  test(`multilingua: "${it}" (IT) e "${en}" (EN) producono lo stesso concetto semantico`, () => {
    assert.equal(classifyFieldConcept(it), classifyFieldConcept(en), `atteso stesso concetto per "${it}"/"${en}", trovati: ${classifyFieldConcept(it)} / ${classifyFieldConcept(en)}`);
    assert.notEqual(classifyFieldConcept(en), 'unknown', `"${en}" non deve ricadere su "unknown"`);
  });
}

test('multilingua: id composti tipici dei blueprint AI (full_name, unit_price, start_date) non ricadono su "unknown"', () => {
  for (const fn of ['full_name', 'unit_price', 'subtotal', 'start_date', 'expiry_date', 'phone', 'price']) {
    assert.notEqual(classifyFieldConcept(fn), 'unknown', `"${fn}" non deve ricadere su "unknown"`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Sezione 8: "nome_prodotto" non deve mai essere scambiato per un nome
// proprio (persona) — la specificità del pattern "product_name" precede il
// pattern generico "nome".
// ═══════════════════════════════════════════════════════════════════════════

test('"nome_prodotto"/"product_name" restano product_name, mai person_name', () => {
  assert.equal(classifyFieldConcept('nome_prodotto'), 'product_name');
  assert.equal(classifyFieldConcept('product_name'), 'product_name');
});

test('"nome_lead"/"nome_cliente_finale" (id composto con "nome") restano person_name', () => {
  assert.equal(classifyFieldConcept('nome_lead'), 'person_name');
  assert.equal(classifyFieldConcept('nome_cliente_finale'), 'person_name');
});

test('"nomenclatura" (un unico token che CONTIENE "nome" come sottostringa) non è un falso positivo per person_name', () => {
  assert.notEqual(classifyFieldConcept('nomenclatura'), 'person_name');
});

// ═══════════════════════════════════════════════════════════════════════════
// "rate"/"tariffa" deve precedere "unit_price"/"prezzo" generico:
// "prezzo_orario" è una TARIFFA, non un prezzo unitario.
// ═══════════════════════════════════════════════════════════════════════════

test('"prezzo_orario"/"hourly_rate" sono classificati come rate, non unit_price', () => {
  assert.equal(classifyFieldConcept('prezzo_orario'), 'rate');
  assert.equal(classifyFieldConcept('hourly_rate'), 'rate');
});

test('"prezzo"/"price" semplice resta unit_price', () => {
  assert.equal(classifyFieldConcept('prezzo'), 'unit_price');
  assert.equal(classifyFieldConcept('price'), 'unit_price');
});

// ═══════════════════════════════════════════════════════════════════════════
// Ruoli semantici e helper isFinancialConcept.
// ═══════════════════════════════════════════════════════════════════════════

test('semanticRole colloca correttamente i concetti nelle 6 categorie', () => {
  assert.equal(semanticRole('person_name'), 'identity');
  assert.equal(semanticRole('date_start'), 'temporal');
  assert.equal(semanticRole('quantity'), 'numeric');
  assert.equal(semanticRole('unit_price'), 'financial');
  assert.equal(semanticRole('status'), 'workflow');
  assert.equal(semanticRole('notes'), 'text');
});

test('isFinancialConcept distingue i concetti monetari da quelli numerici non finanziari', () => {
  assert.ok(isFinancialConcept('unit_price'));
  assert.ok(isFinancialConcept('total_cost'));
  assert.ok(isFinancialConcept('currency_generic'));
  assert.ok(!isFinancialConcept('quantity'));
  assert.ok(!isFinancialConcept('duration'));
  assert.ok(!isFinancialConcept('year'));
});

// ═══════════════════════════════════════════════════════════════════════════
// Regressione: concetti numerici semanticamente indipendenti (Caso E, già
// coperto in mockDataGenerator.test.ts) non devono mai essere confusi con un
// ruolo finanziario.
// ═══════════════════════════════════════════════════════════════════════════

test('campi numerici indipendenti (numero_dipendenti, punteggio, anno_fondazione, quantita_prodotti) non sono concetti finanziari', () => {
  assert.ok(!isFinancialConcept(classifyFieldConcept('punteggio')));
  assert.equal(classifyFieldConcept('anno_fondazione'), 'year');
  assert.equal(classifyFieldConcept('quantita_prodotti'), 'quantity');
});

// ═══════════════════════════════════════════════════════════════════════════
// CreatorAI V4, P1-5: isTerminalStateValue — bug verificato dal vivo
// (benchmark post-hardening), "vinto" (CRM) e "chiuso" (Interventi) restavano
// permissivi (mostravano ancora pulsanti di transizione) mentre "perso"
// (CRM) era correttamente riconosciuto come terminale.
// ═══════════════════════════════════════════════════════════════════════════

test('isTerminalStateValue riconosce i valori di stato osservati nel benchmark come terminali (IT e EN)', () => {
  for (const v of ['vinto', 'perso', 'chiuso', 'won', 'lost', 'closed', 'completato', 'annullato', 'cancellato', 'concluso', 'completed', 'cancelled', 'canceled', 'done']) {
    assert.ok(isTerminalStateValue(v), `"${v}" dovrebbe essere riconosciuto come stato terminale`);
  }
});

test('isTerminalStateValue NON marca come terminali stati intermedi legittimi', () => {
  for (const v of ['nuovo', 'in_trattativa', 'in_corso', 'aperto', 'attivo', 'disponibile', 'sospeso', 'in_preparazione', 'pronto', 'spedito', 'pending', 'active']) {
    assert.ok(!isTerminalStateValue(v), `"${v}" NON dovrebbe essere riconosciuto come stato terminale`);
  }
});

test('isTerminalStateValue è case/accento-insensitive (stesso normalizeFieldName degli altri concetti)', () => {
  assert.ok(isTerminalStateValue('VINTO'));
  assert.ok(isTerminalStateValue('Chiuso'));
  assert.ok(isTerminalStateValue('annullàto'));
});
