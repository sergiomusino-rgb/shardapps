// ─── Test del Condition Evaluator (CreatorAI Engine 2.0, Fase 4) ───────────
// Modulo puro, nessun mock necessario. Uso: node --test lib (da backend/).

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateCondition, evaluateLeaf } = require('./condition-evaluator');

const RECORD = { id: 'r1', data: { status: 'paid', total: 150, note: 'Ordine urgente', empty: null } };

// ─── operatori singoli ───────────────────────────────────────────────────

test('equals: valore uguale -> true', () => {
  assert.equal(evaluateLeaf({ field: 'status', operator: 'equals', value: 'paid' }, RECORD), true);
});

test('equals: valore diverso -> false', () => {
  assert.equal(evaluateLeaf({ field: 'status', operator: 'equals', value: 'pending' }, RECORD), false);
});

test('not_equals: valore diverso -> true', () => {
  assert.equal(evaluateLeaf({ field: 'status', operator: 'not_equals', value: 'pending' }, RECORD), true);
});

test('contains: sottostringa presente (case-insensitive) -> true', () => {
  assert.equal(evaluateLeaf({ field: 'note', operator: 'contains', value: 'urgente' }, RECORD), true);
});

test('contains: sottostringa assente -> false', () => {
  assert.equal(evaluateLeaf({ field: 'note', operator: 'contains', value: 'noleggio' }, RECORD), false);
});

test('not_contains: sottostringa assente -> true', () => {
  assert.equal(evaluateLeaf({ field: 'note', operator: 'not_contains', value: 'noleggio' }, RECORD), true);
});

test('greater_than: numerico vero', () => {
  assert.equal(evaluateLeaf({ field: 'total', operator: 'greater_than', value: 100 }, RECORD), true);
});

test('less_than: numerico falso', () => {
  assert.equal(evaluateLeaf({ field: 'total', operator: 'less_than', value: 100 }, RECORD), false);
});

test('greater_or_equal: uguale -> true', () => {
  assert.equal(evaluateLeaf({ field: 'total', operator: 'greater_or_equal', value: 150 }, RECORD), true);
});

test('less_or_equal: uguale -> true', () => {
  assert.equal(evaluateLeaf({ field: 'total', operator: 'less_or_equal', value: 150 }, RECORD), true);
});

test('comparazione numerica su un valore non numerico -> false (mai un confronto ambiguo)', () => {
  assert.equal(evaluateLeaf({ field: 'status', operator: 'greater_than', value: 10 }, RECORD), false);
});

test('exists: campo presente -> true', () => {
  assert.equal(evaluateLeaf({ field: 'status', operator: 'exists' }, RECORD), true);
});

test('exists: campo null -> false', () => {
  assert.equal(evaluateLeaf({ field: 'empty', operator: 'exists' }, RECORD), false);
});

test('exists: campo assente -> false', () => {
  assert.equal(evaluateLeaf({ field: 'mai_esistito', operator: 'exists' }, RECORD), false);
});

test('not_exists: campo null -> true', () => {
  assert.equal(evaluateLeaf({ field: 'empty', operator: 'not_exists' }, RECORD), true);
});

// ─── AND / OR ────────────────────────────────────────────────────────────

test('AND: tutte vere -> true', () => {
  const node = {
    operator: 'AND',
    conditions: [
      { field: 'status', operator: 'equals', value: 'paid' },
      { field: 'total', operator: 'greater_than', value: 100 },
    ],
  };
  assert.equal(evaluateCondition(node, RECORD), true);
});

test('AND: una falsa -> false', () => {
  const node = {
    operator: 'AND',
    conditions: [
      { field: 'status', operator: 'equals', value: 'paid' },
      { field: 'total', operator: 'greater_than', value: 1000 },
    ],
  };
  assert.equal(evaluateCondition(node, RECORD), false);
});

test('OR: almeno una vera -> true', () => {
  const node = {
    operator: 'OR',
    conditions: [
      { field: 'status', operator: 'equals', value: 'pending' },
      { field: 'total', operator: 'greater_than', value: 100 },
    ],
  };
  assert.equal(evaluateCondition(node, RECORD), true);
});

test('OR: tutte false -> false', () => {
  const node = {
    operator: 'OR',
    conditions: [
      { field: 'status', operator: 'equals', value: 'pending' },
      { field: 'total', operator: 'greater_than', value: 1000 },
    ],
  };
  assert.equal(evaluateCondition(node, RECORD), false);
});

test('gruppi annidati (AND di un OR) valutati ricorsivamente', () => {
  const node = {
    operator: 'AND',
    conditions: [
      { field: 'status', operator: 'equals', value: 'paid' },
      { operator: 'OR', conditions: [
        { field: 'total', operator: 'greater_than', value: 1000 },
        { field: 'note', operator: 'contains', value: 'urgente' },
      ] },
    ],
  };
  assert.equal(evaluateCondition(node, RECORD), true);
});

// ─── condizioni invalide / assenti ───────────────────────────────────────

test('condizione assente (undefined) -> true (nessun vincolo)', () => {
  assert.equal(evaluateCondition(undefined, RECORD), true);
});

test('condizione null -> true (nessun vincolo)', () => {
  assert.equal(evaluateCondition(null, RECORD), true);
});

test('operatore sconosciuto -> false (fail-closed, mai eseguito per errore)', () => {
  assert.equal(evaluateLeaf({ field: 'status', operator: 'not_a_real_operator', value: 'paid' }, RECORD), false);
});

test('nodo di tipo primitivo (stringa) invece di oggetto -> false (fail-closed)', () => {
  assert.equal(evaluateCondition('not-a-condition', RECORD), false);
});

test('gruppo AND con conditions vuoto -> true (nessun vincolo residuo)', () => {
  assert.equal(evaluateCondition({ operator: 'AND', conditions: [] }, RECORD), true);
});

test('nessun eval()/Function() coinvolto: un field che assomiglia a codice non viene mai eseguito', () => {
  const malicious = { field: 'status', operator: 'equals', value: "'; process.exit(1); //" };
  // Deve semplicemente valutare un confronto stringa fallito, non eseguire nulla.
  assert.equal(evaluateLeaf(malicious, RECORD), false);
});
