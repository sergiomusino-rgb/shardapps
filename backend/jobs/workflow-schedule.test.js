// ─── Test: workflow-schedule job (Pre-Beta Hardening, Blocco 2) ────────────
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeSupabase } = require('../lib/test-helpers/fake-supabase');
const { tickOnce, currentTickBucketKey } = require('./workflow-schedule');

function scheduleTickWorkflow({ id = 'wf1', enabled = true, entity } = {}) {
  return {
    id,
    name: 'Tick di test',
    enabled,
    trigger: { event: 'schedule.tick', ...(entity ? { entity } : {}) },
    actions: [{ type: 'update_field', field: 'x', value: 1 }],
  };
}

test('app senza alcun workflow schedule.tick: routeEvent mai chiamato', async () => {
  const supabase = makeFakeSupabase({
    apps: [{ id: 'app-1', tenant_id: 'tenant-1', config: { workflows: [] } }],
  });
  const calls = [];
  await tickOnce(supabase, { routeEvent: async (...args) => calls.push(args) });
  assert.equal(calls.length, 0);
});

test('workflow disabilitato: mai innescato', async () => {
  const supabase = makeFakeSupabase({
    apps: [{ id: 'app-1', tenant_id: 'tenant-1', config: { workflows: [scheduleTickWorkflow({ enabled: false })] } }],
  });
  const calls = [];
  await tickOnce(supabase, { routeEvent: async (...args) => calls.push(args) });
  assert.equal(calls.length, 0);
});

test('workflow schedule.tick SENZA entity: un solo evento "a vuoto" (nessun record)', async () => {
  const supabase = makeFakeSupabase({
    apps: [{ id: 'app-1', tenant_id: 'tenant-1', config: { workflows: [scheduleTickWorkflow()] } }],
  });
  const calls = [];
  await tickOnce(supabase, { routeEvent: async (...args) => calls.push(args) });
  assert.equal(calls.length, 1);
  const [, event] = calls[0];
  assert.equal(event.type, 'schedule.tick');
  assert.equal(event.appId, 'app-1');
  assert.equal(event.tenantId, 'tenant-1');
  assert.equal(event.record, undefined);
});

test('workflow schedule.tick CON entity: un evento per ogni record di quella entità', async () => {
  const supabase = makeFakeSupabase({
    apps: [{ id: 'app-1', tenant_id: 'tenant-1', config: { workflows: [scheduleTickWorkflow({ entity: 'ordini' })] } }],
    app_records: [
      { id: 'r1', app_id: 'app-1', tenant_id: 'tenant-1', table_name: 'ordini', data: {} },
      { id: 'r2', app_id: 'app-1', tenant_id: 'tenant-1', table_name: 'ordini', data: {} },
      // Record di un'ALTRA app: non deve mai comparire (isolamento).
      { id: 'r3', app_id: 'app-other', tenant_id: 'tenant-other', table_name: 'ordini', data: {} },
    ],
  });
  const calls = [];
  await tickOnce(supabase, { routeEvent: async (...args) => calls.push(args) });
  assert.equal(calls.length, 2);
  const recordIds = calls.map(([, event]) => event.record.id).sort();
  assert.deepEqual(recordIds, ['r1', 'r2']);
  for (const [, event] of calls) {
    assert.equal(event.entity, 'ordini');
    assert.equal(event.appId, 'app-1');
  }
});

test('due app diverse con workflow tick: ognuna riceve i propri eventi, isolamento tenant/app rispettato', async () => {
  const supabase = makeFakeSupabase({
    apps: [
      { id: 'app-1', tenant_id: 'tenant-1', config: { workflows: [scheduleTickWorkflow({ id: 'wf-a' })] } },
      { id: 'app-2', tenant_id: 'tenant-2', config: { workflows: [scheduleTickWorkflow({ id: 'wf-b' })] } },
    ],
  });
  const calls = [];
  await tickOnce(supabase, { routeEvent: async (...args) => calls.push(args) });
  const appIds = calls.map(([, event]) => event.appId).sort();
  assert.deepEqual(appIds, ['app-1', 'app-2']);
});

test('supabase non configurato (undefined) -> no-op sicuro, mai un\'eccezione', async () => {
  await assert.doesNotReject(() => tickOnce(undefined, {}));
});

test('errore nella query app -> nessuna eccezione propagata, tick abortito in sicurezza', async () => {
  const supabase = { from() { return { select() { return this; }, not() { return Promise.resolve({ data: null, error: { message: 'db down' } }); } }; } };
  await assert.doesNotReject(() => tickOnce(supabase, {}));
});

test('currentTickBucketKey: stabile entro la stessa finestra di 15 minuti, cambia tra finestre diverse', () => {
  const key = currentTickBucketKey();
  assert.match(key, /^\d+$/);
  const FIFTEEN_MIN_MS = 15 * 60 * 1000;
  const expectedBucket = String(Math.floor(Date.now() / FIFTEEN_MIN_MS));
  assert.equal(key, expectedBucket);
});
