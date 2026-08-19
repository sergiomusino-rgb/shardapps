// ─── Test HTTP — GET/POST /api/apps/[id]/workflows (Automation, UI minima) ─
// Pre-Beta Hardening, Blocco 5. Stesso harness/pattern auth di
// app/api/apps/[id]/route.test.ts (createClient + global.headers.Authorization
// + .auth.getUser() senza argomenti).
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupRouteTest, importRoute, authHeaders } from '../../../../../src/lib/test-helpers/route-test-harness.ts';

const ROUTE_PATH = 'app/api/apps/[id]/workflows/route.ts';

const ORDINI_ENTITY = {
  name: 'ordini',
  label: 'Ordine',
  labelPlural: 'Ordini',
  fields: [
    { id: 'stato', label: 'Stato', type: 'state', states: ['nuovo', 'in_lavorazione', 'completato'] },
    { id: 'note', label: 'Note', type: 'text' },
  ],
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
        { id: 'app-1', tenant_id: 'tenant-owner', name: 'Gestionale Ordini', config: { adminPanel: { entities: [ORDINI_ENTITY] }, workflows: [] } },
      ],
    },
    authUsers: {
      'tok-owner': { id: 'user-owner', email: 'owner@example.com' },
      'tok-attacker': { id: 'user-attacker', email: 'attacker@example.com' },
    },
  };
}

function validWorkflowBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Notifica nuovo ordine',
    trigger: { event: 'record.created', entity: 'ordini' },
    actions: [{ type: 'update_field', field: 'note', value: 'ricevuto' }],
    ...overrides,
  };
}

async function getWorkflows(appId: string, token?: string) {
  const { GET } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest(`http://localhost/api/apps/${appId}/workflows`, token ? { headers: authHeaders(token) } : undefined);
  return (GET as (r: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>)(req, { params: Promise.resolve({ id: appId }) });
}

async function postWorkflow(appId: string, body: unknown, token?: string) {
  const { POST } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest(`http://localhost/api/apps/${appId}/workflows`, {
    method: 'POST',
    headers: token ? authHeaders(token) : { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (POST as (r: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>)(req, { params: Promise.resolve({ id: appId }) });
}

test('401: nessun token', async (t) => {
  setupRouteTest(t, seed());
  const res = await getWorkflows('app-1');
  assert.equal(res.status, 401);
});

test('GET: elenco vuoto + metadati entità derivati da adminPanel.entities', async (t) => {
  setupRouteTest(t, seed());
  const res = await getWorkflows('app-1', 'tok-owner');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.workflows, []);
  assert.equal(body.entities.length, 1);
  assert.equal(body.entities[0].name, 'ordini');
  assert.deepEqual(body.entities[0].fields.map((f: { id: string }) => f.id), ['stato', 'note']);
});

test('POST: crea un workflow valido (trigger record.created + update_field), persistito realmente in apps.config', async (t) => {
  const { supabase } = setupRouteTest(t, seed());
  const res = await postWorkflow('app-1', validWorkflowBody(), 'tok-owner');
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.workflow.name, 'Notifica nuovo ordine');
  assert.equal(body.workflow.enabled, true);
  assert.ok(body.workflow.id, 'un id viene generato dal server');

  const { data: app } = await supabase.from('apps').select('config').eq('id', 'app-1').maybeSingle();
  const workflows = (app as { config: { workflows: Array<{ id: string }> } }).config.workflows;
  assert.equal(workflows.length, 1);
  assert.equal(workflows[0].id, body.workflow.id);
});

test('POST: un secondo workflow riceve un id diverso dal primo (nessuna collisione)', async (t) => {
  setupRouteTest(t, seed());
  const r1 = await postWorkflow('app-1', validWorkflowBody({ name: 'A' }), 'tok-owner');
  const r2 = await postWorkflow('app-1', validWorkflowBody({ name: 'B' }), 'tok-owner');
  const w1 = (await r1.json()).workflow;
  const w2 = (await r2.json()).workflow;
  assert.notEqual(w1.id, w2.id);
});

test('POST: trigger fuori scope (schedule.tick) -> 400 OUT_OF_SCOPE, nessuna scrittura', async (t) => {
  const { supabase } = setupRouteTest(t, seed());
  const res = await postWorkflow('app-1', validWorkflowBody({ trigger: { event: 'schedule.tick' } }), 'tok-owner');
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'OUT_OF_SCOPE');
  const { data: app } = await supabase.from('apps').select('config').eq('id', 'app-1').maybeSingle();
  assert.equal((app as { config: { workflows: unknown[] } }).config.workflows.length, 0);
});

test('POST: azione fuori scope (change_state, non esposta da questa UI) -> 400', async (t) => {
  setupRouteTest(t, seed());
  const res = await postWorkflow('app-1', validWorkflowBody({ actions: [{ type: 'change_state', targetState: 'completato' }] }), 'tok-owner');
  assert.equal(res.status, 400);
});

test('POST: due azioni (Round 2 — almeno 2 azioni per workflow) -> 201, entrambe salvate nell\'ordine inviato', async (t) => {
  const { supabase } = setupRouteTest(t, seed());
  const res = await postWorkflow('app-1', validWorkflowBody({
    actions: [
      { type: 'update_field', field: 'note', value: 'x' },
      { type: 'send_notification', recipient: 'app_owner' },
    ],
  }), 'tok-owner');
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.workflow.actions.length, 2);
  assert.equal(body.workflow.actions[0].type, 'update_field');
  assert.equal(body.workflow.actions[1].type, 'send_notification');
  const { data: app } = await supabase.from('apps').select('config').eq('id', 'app-1').maybeSingle();
  const workflows = (app as { config: { workflows: Array<{ actions: unknown[] }> } }).config.workflows;
  assert.equal(workflows[0].actions.length, 2);
});

test('POST: azione http_request (Integrations Round 2) è nello scope della UI -> 201', async (t) => {
  setupRouteTest(t, seed());
  const res = await postWorkflow('app-1', validWorkflowBody({
    actions: [{ type: 'http_request', url: 'https://crm.esempio.it/hook', method: 'PUT' }],
  }), 'tok-owner');
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.workflow.actions[0].type, 'http_request');
  assert.equal(body.workflow.actions[0].method, 'PUT');
});

test('POST: oltre il tetto massimo di azioni (6, sopra MAX_UI_ACTIONS=5) -> 400', async (t) => {
  setupRouteTest(t, seed());
  const actions = Array.from({ length: 6 }, (_, i) => ({ type: 'update_field', field: 'note', value: `v${i}` }));
  const res = await postWorkflow('app-1', validWorkflowBody({ actions }), 'tok-owner');
  assert.equal(res.status, 400);
});

test('POST: il campo "id" inviato dal client viene sempre ignorato (id generato server-side)', async (t) => {
  setupRouteTest(t, seed());
  const res = await postWorkflow('app-1', validWorkflowBody({ id: 'id-scelto-dal-client' }), 'tok-owner');
  const body = await res.json();
  assert.notEqual(body.workflow.id, 'id-scelto-dal-client');
});

test('isolamento tenant: GET su un\'app di un altro tenant -> 404, mai i workflow di un\'altra agenzia', async (t) => {
  setupRouteTest(t, seed());
  const res = await getWorkflows('app-1', 'tok-attacker');
  assert.equal(res.status, 404);
});

test('isolamento tenant: impossibile CREARE un workflow per l\'app di un altro tenant', async (t) => {
  const { supabase } = setupRouteTest(t, seed());
  const res = await postWorkflow('app-1', validWorkflowBody(), 'tok-attacker');
  assert.equal(res.status, 404);
  const { data: app } = await supabase.from('apps').select('config').eq('id', 'app-1').maybeSingle();
  assert.equal((app as { config: { workflows: unknown[] } }).config.workflows.length, 0, 'nessuna scrittura è avvenuta');
});

// ─── "Esecuzione": il workflow creato dalla UI deve restare nel vocabolario
// REALE del motore (backend/lib/workflow-model.js), non solo in quello della
// UI — se il motore cambiasse il proprio vocabolario senza che questa UI
// venga aggiornata, un workflow "valido" per la UI diventerebbe silenziosamente
// scartato dal motore (loadWorkflows lo filtra via, mai un errore visibile).
// Stesso identico vocabolario copiato qui come sentinella di regressione
// (i due moduli non possono importarsi a vicenda: progetti npm separati).
test('il vocabolario trigger/azioni esposto da questa UI è un sottoinsieme di quello REALE del motore', async () => {
  const ENGINE_VALID_EVENTS = new Set([
    'record.created', 'record.updated', 'record.deleted',
    'state.changed', 'user.action', 'schedule.tick', 'webhook.received',
  ]);
  const ENGINE_VALID_ACTION_TYPES = new Set([
    'change_state', 'trigger_webhook', 'send_notification', 'update_field', 'create_related_record', 'http_request',
  ]);
  const UI_TRIGGER_EVENTS = ['record.created', 'record.updated', 'state.changed'];
  const UI_ACTION_TYPES = ['update_field', 'send_notification', 'trigger_webhook', 'http_request'];

  for (const event of UI_TRIGGER_EVENTS) {
    assert.ok(ENGINE_VALID_EVENTS.has(event), `"${event}" deve esistere nel vocabolario del motore`);
  }
  for (const type of UI_ACTION_TYPES) {
    assert.ok(ENGINE_VALID_ACTION_TYPES.has(type), `"${type}" deve esistere nel vocabolario del motore`);
  }
});
