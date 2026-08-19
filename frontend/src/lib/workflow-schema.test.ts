// ─── Test isolati — WorkflowActionSchema/WorkflowSchema (CreatorAI Engine ───
// 2.0, Fase 4 + Integrations Round 2) ────────────────────────────────────
// node:test nativo, stesso stile di site-schema.test.ts: solo Zod puro,
// nessuna rete/DB. Copre in particolare la nuova azione 'http_request'
// (Pre-Beta Hardening Round 2) e conferma che gli altri 4 tipi di azione già
// esistenti continuino a validare come prima.
//
// Uso: node --test src/lib/workflow-schema.test.ts (dalla cartella frontend/).

import test from 'node:test';
import { describe } from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowActionSchema, WorkflowSchema, WorkflowTriggerSchema, WorkflowTriggerEventSchema } from './site-schema.ts';

describe('WorkflowTriggerEventSchema / WorkflowTriggerSchema', () => {
  test('webhook.received è un evento valido (Integrations Round 2)', () => {
    assert.equal(WorkflowTriggerEventSchema.parse('webhook.received'), 'webhook.received');
  });
  test('evento non nel vocabolario -> lancia', () => {
    assert.throws(() => WorkflowTriggerEventSchema.parse('evento.inventato'));
  });
  test('trigger minimo valido (solo event) -> entity/actionId/toState/fromState undefined', () => {
    const t = WorkflowTriggerSchema.parse({ event: 'record.created' });
    assert.equal(t.event, 'record.created');
    assert.equal(t.entity, undefined);
  });
});

describe('WorkflowActionSchema — tipi pre-esistenti (nessuna regressione)', () => {
  test('change_state valido', () => {
    const a = WorkflowActionSchema.parse({ type: 'change_state', targetState: 'pronto' });
    assert.deepEqual(a, { type: 'change_state', targetState: 'pronto' });
  });
  test('change_state senza targetState -> lancia', () => {
    assert.throws(() => WorkflowActionSchema.parse({ type: 'change_state' }));
  });
  test('trigger_webhook con URL pubblico valido -> mantenuto', () => {
    const a = WorkflowActionSchema.parse({ type: 'trigger_webhook', webhookUrl: 'https://example.com/hook' });
    assert.equal(a.type, 'trigger_webhook');
    if (a.type === 'trigger_webhook') assert.equal(a.webhookUrl, 'https://example.com/hook');
  });
  test('trigger_webhook con URL privato -> silenziosamente svuotato a undefined (stessa barriera "prima linea" di http_request)', () => {
    const a = WorkflowActionSchema.parse({ type: 'trigger_webhook', webhookUrl: 'http://127.0.0.1/hook' });
    if (a.type === 'trigger_webhook') assert.equal(a.webhookUrl, undefined);
  });
  test('send_notification con default recipient app_owner', () => {
    const a = WorkflowActionSchema.parse({ type: 'send_notification' });
    assert.equal(a.type, 'send_notification');
    if (a.type === 'send_notification') assert.equal(a.recipient, 'app_owner');
  });
  test('update_field senza field -> lancia', () => {
    assert.throws(() => WorkflowActionSchema.parse({ type: 'update_field', value: 1 }));
  });
  test('create_related_record: fieldMapping assente -> default {}', () => {
    const a = WorkflowActionSchema.parse({ type: 'create_related_record', targetEntity: 'ordini' });
    assert.equal(a.type, 'create_related_record');
    if (a.type === 'create_related_record') assert.deepEqual(a.fieldMapping, {});
  });
  test('tipo sconosciuto -> lancia (discriminatedUnion chiuso)', () => {
    assert.throws(() => WorkflowActionSchema.parse({ type: 'delete_everything' }));
  });
});

describe('WorkflowActionSchema — http_request (Integrations Round 2)', () => {
  test('minimo valido -> default method POST, headers {}, body undefined', () => {
    const a = WorkflowActionSchema.parse({ type: 'http_request', url: 'https://example.com/api' });
    assert.equal(a.type, 'http_request');
    if (a.type === 'http_request') {
      assert.equal(a.url, 'https://example.com/api');
      assert.equal(a.method, 'POST');
      assert.deepEqual(a.headers, {});
      assert.equal(a.body, undefined);
    }
  });
  test('url mancante -> transform a undefined (mai un URL letterale non-http passato a valle)', () => {
    const a = WorkflowActionSchema.parse({ type: 'http_request' });
    if (a.type === 'http_request') assert.equal(a.url, undefined);
  });
  test('url privato/riservato -> svuotato a undefined (stessa prima linea di difesa di WebhookUrlFieldSchema)', () => {
    const a = WorkflowActionSchema.parse({ type: 'http_request', url: 'http://169.254.169.254/latest/meta-data' });
    if (a.type === 'http_request') assert.equal(a.url, undefined);
  });
  test('method esplicito valido -> mantenuto', () => {
    const a = WorkflowActionSchema.parse({ type: 'http_request', url: 'https://x.test', method: 'DELETE' });
    if (a.type === 'http_request') assert.equal(a.method, 'DELETE');
  });
  test('method non ammesso -> fallback POST (.catch), mai un valore arbitrario', () => {
    const a = WorkflowActionSchema.parse({ type: 'http_request', url: 'https://x.test', method: 'TRACE' });
    if (a.type === 'http_request') assert.equal(a.method, 'POST');
  });
  test('headers: solo coppie stringa/stringa ammesse dallo schema', () => {
    const a = WorkflowActionSchema.parse({ type: 'http_request', url: 'https://x.test', headers: { Authorization: 'Bearer abc' } });
    if (a.type === 'http_request') assert.deepEqual(a.headers, { Authorization: 'Bearer abc' });
  });
  test('headers con valore non stringa -> lancia (record(string,string) è rigoroso, a differenza della normalizzazione difensiva del backend)', () => {
    assert.throws(() => WorkflowActionSchema.parse({ type: 'http_request', url: 'https://x.test', headers: { 'X-Count': 5 } }));
  });
  test('body stringa -> mantenuto; body assente/null -> undefined', () => {
    const withBody = WorkflowActionSchema.parse({ type: 'http_request', url: 'https://x.test', body: '{"a":1}' });
    if (withBody.type === 'http_request') assert.equal(withBody.body, '{"a":1}');
    const withoutBody = WorkflowActionSchema.parse({ type: 'http_request', url: 'https://x.test', body: null });
    if (withoutBody.type === 'http_request') assert.equal(withoutBody.body, undefined);
  });
});

describe('WorkflowSchema', () => {
  test('workflow valido con azione http_request', () => {
    const w = WorkflowSchema.parse({
      id: 'notifica-crm',
      name: 'Notifica CRM esterno',
      trigger: { event: 'record.created', entity: 'ordini' },
      actions: [{ type: 'http_request', url: 'https://crm.example.com/hook', method: 'PUT' }],
    });
    assert.equal(w.actions.length, 1);
    assert.equal(w.actions[0].type, 'http_request');
  });
  test('actions vuoto -> lancia (min 1)', () => {
    assert.throws(() => WorkflowSchema.parse({ trigger: { event: 'record.created' }, actions: [] }));
  });
  test('più di 20 azioni -> lancia (max 20)', () => {
    const actions = Array.from({ length: 21 }, () => ({ type: 'change_state' as const, targetState: 'x' }));
    assert.throws(() => WorkflowSchema.parse({ trigger: { event: 'record.created' }, actions }));
  });
  test('enabled assente -> default true; enabled:false -> mantenuto false', () => {
    const w1 = WorkflowSchema.parse({ trigger: { event: 'record.created' }, actions: [{ type: 'change_state', targetState: 'x' }] });
    assert.equal(w1.enabled, true);
    const w2 = WorkflowSchema.parse({ trigger: { event: 'record.created' }, actions: [{ type: 'change_state', targetState: 'x' }], enabled: false });
    assert.equal(w2.enabled, false);
  });
  test('conditions con gruppo AND/OR annidato -> valido (albero già supportato dallo schema)', () => {
    const w = WorkflowSchema.parse({
      trigger: { event: 'record.created', entity: 'ordini' },
      conditions: {
        operator: 'AND',
        conditions: [
          { field: 'totale', operator: 'greater_than', value: 100 },
          { operator: 'OR', conditions: [{ field: 'stato', operator: 'equals', value: 'nuovo' }] },
        ],
      },
      actions: [{ type: 'change_state', targetState: 'urgente' }],
    });
    assert.equal(w.conditions?.operator, 'AND');
  });
});
