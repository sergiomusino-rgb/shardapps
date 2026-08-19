// ─── Test di lib/workflow-model.js (Fase 4 + Integrations Round 2) ─────────
// Modulo puro (nessun I/O): normalizza apps.config.workflows in modo
// difensivo. Copre in particolare la nuova azione http_request (Pre-Beta
// Hardening Round 2) e conferma che il comportamento pre-esistente per le
// altre azioni non sia mai regredito.
//
// Uso: node --test lib (dalla cartella backend/), o npm test.

const test = require('node:test');
const { describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  loadWorkflows,
  normalizeWorkflow,
  normalizeTrigger,
  normalizeAction,
  VALID_EVENTS,
  VALID_ACTION_TYPES,
  VALID_HTTP_METHODS,
} = require('./workflow-model');

describe('normalizeTrigger', () => {
  test('evento valido -> passa con i campi opzionali presenti', () => {
    const t = normalizeTrigger({ event: 'record.created', entity: 'ordini', actionId: 'spedisci' });
    assert.deepEqual(t, { event: 'record.created', entity: 'ordini', actionId: 'spedisci', toState: undefined, fromState: undefined });
  });
  test('evento non nel vocabolario -> null', () => {
    assert.equal(normalizeTrigger({ event: 'evento.inventato' }), null);
  });
  test('input non oggetto -> null, mai un\'eccezione', () => {
    assert.equal(normalizeTrigger(null), null);
    assert.equal(normalizeTrigger(undefined), null);
    assert.equal(normalizeTrigger('record.created'), null);
  });
  test('webhook.received è nel vocabolario eventi valido (Integrations Round 2)', () => {
    assert.equal(VALID_EVENTS.has('webhook.received'), true);
    const t = normalizeTrigger({ event: 'webhook.received' });
    assert.equal(t.event, 'webhook.received');
  });
});

describe('normalizeAction — tipi pre-esistenti (nessuna regressione)', () => {
  test('change_state valido', () => {
    assert.deepEqual(normalizeAction({ type: 'change_state', targetState: 'pronto' }), { type: 'change_state', targetState: 'pronto' });
  });
  test('change_state senza targetState -> null', () => {
    assert.equal(normalizeAction({ type: 'change_state' }), null);
  });
  test('trigger_webhook valido', () => {
    const a = normalizeAction({ type: 'trigger_webhook', webhookUrl: 'https://example.com/hook' });
    assert.deepEqual(a, { type: 'trigger_webhook', webhookUrl: 'https://example.com/hook' });
  });
  test('send_notification con default label/id', () => {
    const a = normalizeAction({ type: 'send_notification', message: 'Ciao' });
    assert.equal(a.type, 'send_notification');
    assert.equal(a.recipient, 'app_owner');
    assert.equal(a.label, 'Notifica');
    assert.equal(a.id, 'notifica');
  });
  test('update_field senza field -> null', () => {
    assert.equal(normalizeAction({ type: 'update_field', value: 1 }), null);
  });
  test('create_related_record senza targetEntity -> null', () => {
    assert.equal(normalizeAction({ type: 'create_related_record', fieldMapping: {} }), null);
  });
  test('tipo sconosciuto -> null', () => {
    assert.equal(normalizeAction({ type: 'delete_everything' }), null);
  });
  test('input non oggetto -> null', () => {
    assert.equal(normalizeAction(null), null);
    assert.equal(normalizeAction('trigger_webhook'), null);
  });
});

describe('normalizeAction — http_request (Integrations Round 2)', () => {
  test('minimo valido -> default method POST, headers {}, body undefined', () => {
    const a = normalizeAction({ type: 'http_request', url: 'https://example.com/api' });
    assert.deepEqual(a, { type: 'http_request', url: 'https://example.com/api', method: 'POST', headers: {}, body: undefined });
  });
  test('senza url -> null (a differenza di trigger_webhook, qui url è obbligatorio a monte)', () => {
    assert.equal(normalizeAction({ type: 'http_request' }), null);
    assert.equal(normalizeAction({ type: 'http_request', url: '' }), null);
  });
  test('metodo esplicito valido, case-insensitive -> normalizzato uppercase', () => {
    assert.equal(normalizeAction({ type: 'http_request', url: 'https://x.test', method: 'get' }).method, 'GET');
    assert.equal(normalizeAction({ type: 'http_request', url: 'https://x.test', method: 'DELETE' }).method, 'DELETE');
  });
  test('metodo non ammesso -> fallback POST, mai una stringa arbitraria passata al fetch', () => {
    const a = normalizeAction({ type: 'http_request', url: 'https://x.test', method: 'TRACE' });
    assert.equal(a.method, 'POST');
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(VALID_HTTP_METHODS.has(m), true);
    assert.equal(VALID_HTTP_METHODS.has('TRACE'), false);
  });
  test('headers: solo coppie stringa/stringa vengono mantenute', () => {
    const a = normalizeAction({
      type: 'http_request', url: 'https://x.test',
      headers: { Authorization: 'Bearer abc', 'X-Count': 5, valid2: 'ok', broken: { nested: true } },
    });
    assert.deepEqual(a.headers, { Authorization: 'Bearer abc', valid2: 'ok' });
  });
  test('headers non oggetto/array -> {}', () => {
    assert.deepEqual(normalizeAction({ type: 'http_request', url: 'https://x.test', headers: 'not-an-object' }).headers, {});
    assert.deepEqual(normalizeAction({ type: 'http_request', url: 'https://x.test', headers: ['a', 'b'] }).headers, {});
    assert.deepEqual(normalizeAction({ type: 'http_request', url: 'https://x.test', headers: null }).headers, {});
  });
  test('body: solo stringa ammessa, altrimenti undefined', () => {
    assert.equal(normalizeAction({ type: 'http_request', url: 'https://x.test', body: '{"a":1}' }).body, '{"a":1}');
    assert.equal(normalizeAction({ type: 'http_request', url: 'https://x.test', body: { a: 1 } }).body, undefined);
    assert.equal(normalizeAction({ type: 'http_request', url: 'https://x.test', body: null }).body, undefined);
  });
  test('http_request è nel vocabolario azioni valido', () => {
    assert.equal(VALID_ACTION_TYPES.has('http_request'), true);
  });
});

describe('normalizeWorkflow / loadWorkflows', () => {
  test('workflow valido con azione http_request viene mantenuto', () => {
    const w = normalizeWorkflow({
      id: 'wf_hook', name: 'Notifica CRM esterno', enabled: true,
      trigger: { event: 'record.created', entity: 'ordini' },
      actions: [{ type: 'http_request', url: 'https://crm.example.com/hook', method: 'PUT' }],
    }, 0);
    assert.equal(w.id, 'wf_hook');
    assert.equal(w.actions.length, 1);
    assert.equal(w.actions[0].type, 'http_request');
    assert.equal(w.actions[0].method, 'PUT');
  });
  test('workflow con SOLO azioni non valide -> scartato (nessun effetto)', () => {
    const w = normalizeWorkflow({
      id: 'wf_vuoto', enabled: true,
      trigger: { event: 'record.created', entity: 'ordini' },
      actions: [{ type: 'http_request' /* senza url */ }, { type: 'change_state' /* senza targetState */ }],
    }, 0);
    assert.equal(w, null);
  });
  test('workflow senza trigger valido -> scartato', () => {
    assert.equal(normalizeWorkflow({ id: 'x', actions: [{ type: 'http_request', url: 'https://x.test' }] }, 0), null);
  });
  test('loadWorkflows filtra i workflow malformati e mantiene solo quelli validi', () => {
    const config = {
      workflows: [
        { id: 'wf_ok', trigger: { event: 'webhook.received' }, actions: [{ type: 'http_request', url: 'https://x.test' }] },
        { id: 'wf_rotto', trigger: { event: 'evento.inventato' }, actions: [{ type: 'http_request', url: 'https://x.test' }] },
        null,
        { id: 'wf_no_actions', trigger: { event: 'record.created' }, actions: [] },
      ],
    };
    const list = loadWorkflows(config);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, 'wf_ok');
  });
  test('config.workflows assente o non array -> []', () => {
    assert.deepEqual(loadWorkflows({}), []);
    assert.deepEqual(loadWorkflows({ workflows: 'not-an-array' }), []);
    assert.deepEqual(loadWorkflows(null), []);
  });
});
