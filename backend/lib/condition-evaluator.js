// ─── Condition Evaluator (CreatorAI Engine 2.0, Fase 4) ────────────────────
// Modulo puro, nessun I/O: valuta un albero di condizioni contro i dati di un
// record. NESSUN eval()/Function()/codice arbitrario — ogni operatore è un
// ramo esplicito di uno switch, l'unico input eseguibile è la stringa
// `operator` confrontata contro un vocabolario chiuso (LEAF_OPERATORS).
//
// Forma di una foglia:   { field, operator, value }
// Forma di un gruppo:    { operator: 'AND'|'OR', conditions: [ ...nodi... ] }
// (i nodi di `conditions` possono essere foglie o altri gruppi, ricorsivo)
//
// Nessuna condizione (undefined/null) = sempre vera: un workflow senza
// `conditions` esegue sempre le sue azioni quando il trigger scatta — stesso
// principio "assente = nessun vincolo" già usato per allowedTransitions in
// frontend/src/lib/site-schema.ts.

const LEAF_OPERATORS = new Set([
  'equals', 'not_equals', 'contains', 'not_contains',
  'greater_than', 'less_than', 'greater_or_equal', 'less_or_equal',
  'exists', 'not_exists',
]);

// `record` può essere il record completo ({ id, data: {...} }) o già il solo
// oggetto dati — questo modulo resta tollerante a entrambe le forme invece
// di imporre al chiamante (event-router.js) quale delle due passare.
function getFieldValue(record, field) {
  if (!record || typeof field !== 'string' || !field) return undefined;
  const data = record && typeof record === 'object' && 'data' in record && record.data && typeof record.data === 'object'
    ? record.data
    : record;
  return data && typeof data === 'object' ? data[field] : undefined;
}

function evaluateLeaf(condition, record) {
  if (!condition || typeof condition !== 'object') return false;
  const { field, operator, value } = condition;
  if (!LEAF_OPERATORS.has(operator)) return false; // operatore sconosciuto: mai eseguire nulla, condizione falsa (fail-closed)

  const actual = getFieldValue(record, field);

  switch (operator) {
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'not_exists':
      return actual === undefined || actual === null;
    case 'equals':
      if (actual === undefined || actual === null) return false;
      return String(actual) === String(value);
    case 'not_equals':
      if (actual === undefined || actual === null) return true;
      return String(actual) !== String(value);
    case 'contains':
      if (actual === undefined || actual === null) return false;
      return String(actual).toLowerCase().includes(String(value ?? '').toLowerCase());
    case 'not_contains':
      if (actual === undefined || actual === null) return true;
      return !String(actual).toLowerCase().includes(String(value ?? '').toLowerCase());
    case 'greater_than':
    case 'less_than':
    case 'greater_or_equal':
    case 'less_or_equal': {
      const a = Number(actual);
      const b = Number(value);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false; // confronto numerico su valore non numerico: mai vero
      if (operator === 'greater_than') return a > b;
      if (operator === 'less_than') return a < b;
      if (operator === 'greater_or_equal') return a >= b;
      return a <= b; // less_or_equal
    }
    default:
      return false;
  }
}

function isGroup(node) {
  return !!node && typeof node === 'object'
    && (node.operator === 'AND' || node.operator === 'OR')
    && Array.isArray(node.conditions);
}

/**
 * Valuta un nodo condizione (foglia o gruppo AND/OR, ricorsivo) contro un
 * record. `node` assente/non un oggetto -> true (nessun vincolo).
 */
function evaluateCondition(node, record) {
  // SOLO l'assenza completa di condizioni (undefined/null, "questo workflow
  // non ha condizioni") è true di default. Qualunque altra forma malformata
  // (stringa, numero, oggetto senza operator/field riconosciuto) è
  // fail-closed: un nodo scritto male non deve mai far scattare un'azione
  // per errore, stessa scelta già fatta in evaluateLeaf per un operatore
  // sconosciuto.
  if (node === undefined || node === null) return true;
  if (typeof node !== 'object') return false;

  if (isGroup(node)) {
    if (node.conditions.length === 0) return true;
    if (node.operator === 'AND') return node.conditions.every((c) => evaluateCondition(c, record));
    return node.conditions.some((c) => evaluateCondition(c, record)); // OR
  }

  return evaluateLeaf(node, record);
}

module.exports = { evaluateCondition, evaluateLeaf, LEAF_OPERATORS };
