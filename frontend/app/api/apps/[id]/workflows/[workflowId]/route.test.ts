// ─── Test HTTP — PATCH/DELETE /api/apps/[id]/workflows/[workflowId] ───────
// Pre-Beta Hardening, Blocco 5.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupRouteTest, importRoute, authHeaders } from '../../../../../../src/lib/test-helpers/route-test-harness.ts';

const ROUTE_PATH = 'app/api/apps/[id]/workflows/[workflowId]/route.ts';

const EXISTING_WORKFLOW = {
  id: 'wf_1',
  name: 'Notifica nuovo ordine',
  enabled: true,
  trigger: { event: 'record.created', entity: 'ordini' },
  actions: [{ type: 'update_field', field: 'note', value: 'ricevuto' }],
};

function seed() {
  return {
    seedTables: {
      tenants: [
        { id: 'tenant-owner', owner_id: 'user-owner' },
        { id: 'tenant-attacker', owner_id: 'user-attacker' },
      ],
      tenant_members: [
        { id: 'tm-1', tenant_id: 'tenant-owner', user_id: 'user-owner', role: 'owner' },
        { id: 'tm-2', tenant_id: 'tenant-attacker', user_id: 'user-attacker', role: 'owner' },
      ],
      apps: [
        { id: 'app-1', tenant_id: 'tenant-owner', name: 'Gestionale Ordini', config: { workflows: [EXISTING_WORKFLOW] } },
      ],
    },
    authUsers: {
      'tok-owner': { id: 'user-owner', email: 'owner@example.com' },
      'tok-attacker': { id: 'user-attacker', email: 'attacker@example.com' },
    },
  };
}

async function patchWorkflow(appId: string, workflowId: string, body: unknown, token?: string) {
  const { PATCH } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest(`http://localhost/api/apps/${appId}/workflows/${workflowId}`, {
    method: 'PATCH',
    headers: token ? authHeaders(token) : { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (PATCH as (r: Request, ctx: { params: Promise<{ id: string; workflowId: string }> }) => Promise<Response>)(
    req, { params: Promise.resolve({ id: appId, workflowId }) }
  );
}

async function deleteWorkflow(appId: string, workflowId: string, token?: string) {
  const { DELETE } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest(`http://localhost/api/apps/${appId}/workflows/${workflowId}`, {
    method: 'DELETE',
    headers: token ? authHeaders(token) : undefined,
  });
  return (DELETE as (r: Request, ctx: { params: Promise<{ id: string; workflowId: string }> }) => Promise<Response>)(
    req, { params: Promise.resolve({ id: appId, workflowId }) }
  );
}

test('PATCH: disattiva un workflow esistente, persistito realmente', async (t) => {
  const { supabase } = setupRouteTest(t, seed());
  const res = await patchWorkflow('app-1', 'wf_1', { enabled: false }, 'tok-owner');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.workflow.enabled, false);

  const { data: app } = await supabase.from('apps').select('config').eq('id', 'app-1').maybeSingle();
  const wf = (app as { config: { workflows: Array<{ id: string; enabled: boolean }> } }).config.workflows[0];
  assert.equal(wf.enabled, false);
});

test('PATCH: riattiva un workflow disattivato', async (t) => {
  setupRouteTest(t, seed());
  await patchWorkflow('app-1', 'wf_1', { enabled: false }, 'tok-owner');
  const res = await patchWorkflow('app-1', 'wf_1', { enabled: true }, 'tok-owner');
  const body = await res.json();
  assert.equal(body.workflow.enabled, true);
});

test('PATCH: body senza "enabled" boolean -> 400 (questa UI supporta solo attiva/disattiva)', async (t) => {
  setupRouteTest(t, seed());
  const res = await patchWorkflow('app-1', 'wf_1', { name: 'nuovo nome' }, 'tok-owner');
  assert.equal(res.status, 400);
});

test('PATCH: workflow inesistente -> 404', async (t) => {
  setupRouteTest(t, seed());
  const res = await patchWorkflow('app-1', 'non-esiste', { enabled: false }, 'tok-owner');
  assert.equal(res.status, 404);
});

test('isolamento tenant: PATCH da un altro tenant -> 404, nessuna modifica', async (t) => {
  const { supabase } = setupRouteTest(t, seed());
  const res = await patchWorkflow('app-1', 'wf_1', { enabled: false }, 'tok-attacker');
  assert.equal(res.status, 404);
  const { data: app } = await supabase.from('apps').select('config').eq('id', 'app-1').maybeSingle();
  const wf = (app as { config: { workflows: Array<{ enabled: boolean }> } }).config.workflows[0];
  assert.equal(wf.enabled, true, 'invariato');
});

// ─── PATCH — modifica completa (Round 2) ────────────────────────────────────

test('PATCH modifica completa: cambia trigger/azioni di un workflow esistente, id/preesistenza invariati', async (t) => {
  const { supabase } = setupRouteTest(t, seed());
  const res = await patchWorkflow('app-1', 'wf_1', {
    name: 'Notifica aggiornata',
    trigger: { event: 'state.changed', entity: 'ordini', toState: 'completato' },
    actions: [
      { type: 'send_notification', recipient: 'app_owner' },
      { type: 'http_request', url: 'https://crm.esempio.it/hook', method: 'POST' },
    ],
  }, 'tok-owner');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.workflow.id, 'wf_1', 'id invariato dalla modifica');
  assert.equal(body.workflow.name, 'Notifica aggiornata');
  assert.equal(body.workflow.trigger.event, 'state.changed');
  assert.equal(body.workflow.actions.length, 2);
  assert.equal(body.workflow.enabled, true, 'enabled non inviato -> resta quello preesistente');

  const { data: app } = await supabase.from('apps').select('config').eq('id', 'app-1').maybeSingle();
  const wf = (app as { config: { workflows: Array<{ id: string; name: string }> } }).config.workflows[0];
  assert.equal(wf.id, 'wf_1');
  assert.equal(wf.name, 'Notifica aggiornata');
});

test('PATCH modifica completa: trigger fuori scope -> 400 OUT_OF_SCOPE, nessuna modifica persistita', async (t) => {
  const { supabase } = setupRouteTest(t, seed());
  const res = await patchWorkflow('app-1', 'wf_1', {
    trigger: { event: 'schedule.tick' },
    actions: [{ type: 'update_field', field: 'note', value: 'x' }],
  }, 'tok-owner');
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'OUT_OF_SCOPE');
  const { data: app } = await supabase.from('apps').select('config').eq('id', 'app-1').maybeSingle();
  const wf = (app as { config: { workflows: Array<{ trigger: { event: string } }> } }).config.workflows[0];
  assert.equal(wf.trigger.event, 'record.created', 'invariato');
});

test('PATCH modifica completa: azione fuori scope (change_state) -> 400', async (t) => {
  setupRouteTest(t, seed());
  const res = await patchWorkflow('app-1', 'wf_1', {
    trigger: { event: 'record.created', entity: 'ordini' },
    actions: [{ type: 'change_state', targetState: 'x' }],
  }, 'tok-owner');
  assert.equal(res.status, 400);
});

test('PATCH modifica completa: il campo "id" inviato dal client viene sempre ignorato (id preso dal path)', async (t) => {
  const { supabase } = setupRouteTest(t, seed());
  const res = await patchWorkflow('app-1', 'wf_1', {
    id: 'id-scelto-dal-client',
    trigger: { event: 'record.created', entity: 'ordini' },
    actions: [{ type: 'update_field', field: 'note', value: 'x' }],
  }, 'tok-owner');
  const body = await res.json();
  assert.equal(body.workflow.id, 'wf_1');
  const { data: app } = await supabase.from('apps').select('config').eq('id', 'app-1').maybeSingle();
  assert.equal((app as { config: { workflows: Array<{ id: string }> } }).config.workflows.length, 1);
});

test('isolamento tenant: PATCH modifica completa da un altro tenant -> 404, nessuna modifica', async (t) => {
  const { supabase } = setupRouteTest(t, seed());
  const res = await patchWorkflow('app-1', 'wf_1', {
    trigger: { event: 'record.updated', entity: 'ordini' },
    actions: [{ type: 'update_field', field: 'note', value: 'attaccato' }],
  }, 'tok-attacker');
  assert.equal(res.status, 404);
  const { data: app } = await supabase.from('apps').select('config').eq('id', 'app-1').maybeSingle();
  const wf = (app as { config: { workflows: Array<{ trigger: { event: string } }> } }).config.workflows[0];
  assert.equal(wf.trigger.event, 'record.created', 'invariato');
});

test('DELETE: rimuove il workflow', async (t) => {
  const { supabase } = setupRouteTest(t, seed());
  const res = await deleteWorkflow('app-1', 'wf_1', 'tok-owner');
  assert.equal(res.status, 200);
  const { data: app } = await supabase.from('apps').select('config').eq('id', 'app-1').maybeSingle();
  assert.equal((app as { config: { workflows: unknown[] } }).config.workflows.length, 0);
});

test('DELETE: workflow inesistente -> 404', async (t) => {
  setupRouteTest(t, seed());
  const res = await deleteWorkflow('app-1', 'non-esiste', 'tok-owner');
  assert.equal(res.status, 404);
});

test('isolamento tenant: DELETE da un altro tenant -> 404, il workflow sopravvive', async (t) => {
  const { supabase } = setupRouteTest(t, seed());
  const res = await deleteWorkflow('app-1', 'wf_1', 'tok-attacker');
  assert.equal(res.status, 404);
  const { data: app } = await supabase.from('apps').select('config').eq('id', 'app-1').maybeSingle();
  assert.equal((app as { config: { workflows: unknown[] } }).config.workflows.length, 1);
});

test('401: nessun token su PATCH/DELETE', async (t) => {
  setupRouteTest(t, seed());
  const patchRes = await patchWorkflow('app-1', 'wf_1', { enabled: false });
  const deleteRes = await deleteWorkflow('app-1', 'wf_1');
  assert.equal(patchRes.status, 401);
  assert.equal(deleteRes.status, 401);
});
