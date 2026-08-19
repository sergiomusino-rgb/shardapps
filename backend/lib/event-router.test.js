// ─── Test dell'Event Router (event-router.js, Fase 4) ──────────────────────
// Fake supabase in memoria (test-helpers/fake-supabase.js), nessuna vera
// rete/DB. Uso: node --test lib (da backend/).

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeSupabase } = require('./test-helpers/fake-supabase');
const { routeEvent } = require('./event-router');

const APP_ID = 'app-1';
const TENANT_ID = 'tenant-1';
const OTHER_APP_ID = 'app-2';
const OTHER_TENANT_ID = 'tenant-2';

const ORDINI_ENTITY = {
  name: 'ordini',
  label: 'Ordine', labelPlural: 'Ordini', icon: '',
  fields: [
    { id: 'id', type: 'id' },
    { id: 'stato', type: 'state', states: ['nuovo', 'pronto'], allowedTransitions: { nuovo: ['pronto'] } },
  ],
  actions: [],
};

function configWith(workflows) {
  return { adminPanel: { entities: [ORDINI_ENTITY] }, workflows };
}

function baseTables(configApp1, configApp2 = {}) {
  return {
    apps: [
      { id: APP_ID, tenant_id: TENANT_ID, client_email: 'owner1@test.it', name: 'App Uno', config: configApp1 },
      { id: OTHER_APP_ID, tenant_id: OTHER_TENANT_ID, client_email: 'owner2@test.it', name: 'App Due', config: configApp2 },
    ],
    app_records: [
      { id: 'rec-1', app_id: APP_ID, tenant_id: TENANT_ID, table_name: 'ordini', data: { stato: 'nuovo', totale: 150 } },
      { id: 'rec-2', app_id: OTHER_APP_ID, tenant_id: OTHER_TENANT_ID, table_name: 'ordini', data: { stato: 'nuovo', totale: 999 } },
    ],
    app_action_logs: [],
  };
}

// ─── evento corretto -> workflow eseguito ───────────────────────────────────

test('record.created con trigger corrispondente -> il workflow esegue le sue azioni', async () => {
  const workflows = [
    { id: 'wf_benvenuto', name: 'Benvenuto', enabled: true,
      trigger: { event: 'record.created', entity: 'ordini' },
      actions: [{ type: 'change_state', targetState: 'pronto' }] },
  ];
  const supabase = makeFakeSupabase(baseTables(configWith(workflows)));
  const record = supabase._tables.app_records.find((r) => r.id === 'rec-1');

  const summary = await routeEvent(supabase, { type: 'record.created', appId: APP_ID, tenantId: TENANT_ID, entity: 'ordini', record });

  assert.equal(summary.matched, 1);
  assert.equal(summary.executed, 1);
  assert.equal(record.data.stato, 'pronto');
});

// ─── workflow disabilitato -> ignorato ──────────────────────────────────────

test('workflow enabled:false -> non eseguito, nessuna azione', async () => {
  const workflows = [
    { id: 'wf_disabilitato', name: 'Disabilitato', enabled: false,
      trigger: { event: 'record.created', entity: 'ordini' },
      actions: [{ type: 'change_state', targetState: 'pronto' }] },
  ];
  const supabase = makeFakeSupabase(baseTables(configWith(workflows)));
  const record = supabase._tables.app_records.find((r) => r.id === 'rec-1');

  const summary = await routeEvent(supabase, { type: 'record.created', appId: APP_ID, tenantId: TENANT_ID, entity: 'ordini', record });

  assert.equal(summary.matched, 0);
  assert.equal(summary.executed, 0);
  assert.equal(record.data.stato, 'nuovo'); // invariato
});

// ─── condition false -> action non eseguita ─────────────────────────────────

test('conditions non soddisfatte -> workflow trovato ma azioni non eseguite', async () => {
  const workflows = [
    { id: 'wf_condizionato', name: 'Solo ordini grandi', enabled: true,
      trigger: { event: 'record.created', entity: 'ordini' },
      conditions: { field: 'totale', operator: 'greater_than', value: 1000 },
      actions: [{ type: 'change_state', targetState: 'pronto' }] },
  ];
  const supabase = makeFakeSupabase(baseTables(configWith(workflows)));
  const record = supabase._tables.app_records.find((r) => r.id === 'rec-1'); // totale: 150, non soddisfa >1000

  const summary = await routeEvent(supabase, { type: 'record.created', appId: APP_ID, tenantId: TENANT_ID, entity: 'ordini', record });

  assert.equal(summary.matched, 1);
  assert.equal(summary.executed, 0);
  assert.equal(summary.results[0].skipped, true);
  assert.equal(record.data.stato, 'nuovo'); // invariato
});

// ─── più workflow sullo stesso evento ────────────────────────────────────────

test('due workflow con lo stesso trigger -> entrambi eseguiti', async () => {
  const workflows = [
    { id: 'wf_a', name: 'A', enabled: true,
      trigger: { event: 'record.created', entity: 'ordini' },
      actions: [{ type: 'update_field', field: 'flagA', value: true }] },
    { id: 'wf_b', name: 'B', enabled: true,
      trigger: { event: 'record.created', entity: 'ordini' },
      actions: [{ type: 'update_field', field: 'flagB', value: true }] },
  ];
  const supabase = makeFakeSupabase(baseTables(configWith(workflows)));
  const record = supabase._tables.app_records.find((r) => r.id === 'rec-1');

  const summary = await routeEvent(supabase, { type: 'record.created', appId: APP_ID, tenantId: TENANT_ID, entity: 'ordini', record });

  assert.equal(summary.matched, 2);
  assert.equal(summary.executed, 2);
  assert.equal(record.data.flagA, true);
  assert.equal(record.data.flagB, true);
});

// ─── workflow malformato -> scartato, gli altri restano validi ─────────────

test('un workflow malformato (senza actions) viene scartato, quello valido nella stessa app esegue comunque', async () => {
  const workflows = [
    { id: 'wf_rotto', name: 'Rotto', enabled: true, trigger: { event: 'record.created', entity: 'ordini' }, actions: [] }, // scartato: nessuna azione valida
    { id: 'wf_valido', name: 'Valido', enabled: true, trigger: { event: 'record.created', entity: 'ordini' },
      actions: [{ type: 'update_field', field: 'ok', value: true }] },
  ];
  const supabase = makeFakeSupabase(baseTables(configWith(workflows)));
  const record = supabase._tables.app_records.find((r) => r.id === 'rec-1');

  const summary = await routeEvent(supabase, { type: 'record.created', appId: APP_ID, tenantId: TENANT_ID, entity: 'ordini', record });

  assert.equal(summary.matched, 1); // solo wf_valido supera la normalizzazione
  assert.equal(record.data.ok, true);
});

// ─── isolamento app/tenant (Security) ───────────────────────────────────────

test('un evento per APP_ID non esegue MAI i workflow di un\'altra app, anche identici', async () => {
  const sameShapeWorkflows = [
    { id: 'wf_x', name: 'X', enabled: true, trigger: { event: 'record.created', entity: 'ordini' },
      actions: [{ type: 'update_field', field: 'toccato', value: true }] },
  ];
  // Entrambe le app hanno lo STESSO workflow (stesso id/trigger) nella propria config.
  const supabase = makeFakeSupabase(baseTables(configWith(sameShapeWorkflows), configWith(sameShapeWorkflows)));
  const recordApp1 = supabase._tables.app_records.find((r) => r.id === 'rec-1');
  const recordApp2 = supabase._tables.app_records.find((r) => r.id === 'rec-2');

  // Evento SOLO per APP_ID.
  await routeEvent(supabase, { type: 'record.created', appId: APP_ID, tenantId: TENANT_ID, entity: 'ordini', record: recordApp1 });

  assert.equal(recordApp1.data.toccato, true);
  assert.equal(recordApp2.data.toccato, undefined); // MAI toccato: l'evento era per un'altra app
});

test('tenantId sbagliato per un appId esistente -> nessuna app trovata, nessun workflow eseguito', async () => {
  const workflows = [
    { id: 'wf_x', name: 'X', enabled: true, trigger: { event: 'record.created', entity: 'ordini' },
      actions: [{ type: 'update_field', field: 'toccato', value: true }] },
  ];
  const supabase = makeFakeSupabase(baseTables(configWith(workflows)));
  const record = supabase._tables.app_records.find((r) => r.id === 'rec-1');

  // tenantId di un'altra app abbinato ad appId di questa: la query
  // .eq('id',appId).eq('tenant_id',tenantId) non deve trovare nulla.
  const summary = await routeEvent(supabase, { type: 'record.created', appId: APP_ID, tenantId: OTHER_TENANT_ID, entity: 'ordini', record });

  assert.equal(summary.matched, 0);
  assert.equal(record.data.toccato, undefined);
});

// ─── evento malformato ───────────────────────────────────────────────────

test('evento senza appId/tenantId/type -> nessun crash, nessun workflow eseguito', async () => {
  const supabase = makeFakeSupabase(baseTables(configWith([])));
  const summary = await routeEvent(supabase, { entity: 'ordini' });
  assert.deepEqual(summary, { matched: 0, executed: 0, results: [] });
});

// ─── state.changed con matcher toState/fromState ────────────────────────────

// ─── webhook.received (Integrations Round 2 — POST /:appId/webhooks/incoming) ─
// Stesso identico shape di evento costruito da routes/public-api.js: nessun
// record preesistente (id:null, data:payload) e actorRole:'external_webhook'.

test('webhook.received con trigger corrispondente -> il workflow esegue (record.id null ammesso, create_related_record non richiede una riga preesistente)', async () => {
  // update_field/change_state non hanno senso su un payload id:null (non
  // c'è alcuna riga app_records da aggiornare): il caso realistico per un
  // webhook "headless" è create_related_record (crea una NUOVA riga a
  // partire dai dati ricevuti) o le azioni di notifica/HTTP (fire-and-
  // forget, coperte a parte in workflow-action-executor.test.js).
  const workflows = [
    { id: 'wf_webhook', name: 'Su webhook ordini', enabled: true,
      trigger: { event: 'webhook.received', entity: 'ordini' },
      actions: [{ type: 'create_related_record', targetEntity: 'ordini_ricevuti', fieldMapping: { cliente: 'cliente' } }] },
  ];
  const supabase = makeFakeSupabase(baseTables(configWith(workflows)));
  const payload = { id: null, data: { cliente: 'Mario', totale: 42 } };

  const summary = await routeEvent(supabase, {
    type: 'webhook.received', appId: APP_ID, tenantId: TENANT_ID, entity: 'ordini',
    record: payload, actorRole: 'external_webhook',
  });

  assert.equal(summary.matched, 1);
  assert.equal(summary.executed, 1);
  // record.id null non deve mai far lanciare l'esecuzione: create_related_record
  // legge solo record.data, mai record.id.
  const created = supabase._tables.app_records.find((r) => r.table_name === 'ordini_ricevuti');
  assert.ok(created, 'una nuova riga deve essere stata creata dal webhook');
  assert.equal(created.data.cliente, 'Mario');
  assert.equal(created.app_id, APP_ID);
  assert.equal(created.tenant_id, TENANT_ID);
});

test('webhook.received senza entity nel trigger -> matcha un trigger generico (senza entity)', async () => {
  const workflows = [
    { id: 'wf_generico', name: 'Qualunque webhook', enabled: true,
      trigger: { event: 'webhook.received' },
      actions: [{ type: 'update_field', field: 'toccato', value: true }] },
  ];
  const supabase = makeFakeSupabase(baseTables(configWith(workflows)));
  const payload = { id: null, data: { qualunque: 'cosa' } };

  const summary = await routeEvent(supabase, {
    type: 'webhook.received', appId: APP_ID, tenantId: TENANT_ID, record: payload, actorRole: 'external_webhook',
  });

  assert.equal(summary.matched, 1);
  assert.equal(summary.executed, 1);
});

test('webhook.received con entity diversa da quella del trigger -> non scatta', async () => {
  const workflows = [
    { id: 'wf_solo_clienti', name: 'Solo clienti', enabled: true,
      trigger: { event: 'webhook.received', entity: 'clienti' },
      actions: [{ type: 'update_field', field: 'toccato', value: true }] },
  ];
  const supabase = makeFakeSupabase(baseTables(configWith(workflows)));
  const payload = { id: null, data: {} };

  const summary = await routeEvent(supabase, {
    type: 'webhook.received', appId: APP_ID, tenantId: TENANT_ID, entity: 'ordini', record: payload, actorRole: 'external_webhook',
  });

  assert.equal(summary.matched, 0);
});

test('webhook.received isolamento: un evento per APP_ID non esegue mai i workflow webhook di un\'altra app', async () => {
  const sameShapeWorkflows = [
    { id: 'wf_hook', name: 'Hook', enabled: true, trigger: { event: 'webhook.received' },
      actions: [{ type: 'create_related_record', targetEntity: 'ricevuti', fieldMapping: {} }] },
  ];
  const supabase = makeFakeSupabase(baseTables(configWith(sameShapeWorkflows), configWith(sameShapeWorkflows)));
  const payloadApp1 = { id: null, data: {} };

  const summary = await routeEvent(supabase, {
    type: 'webhook.received', appId: APP_ID, tenantId: TENANT_ID, record: payloadApp1, actorRole: 'external_webhook',
  });

  assert.equal(summary.matched, 1);
  const createdRows = supabase._tables.app_records.filter((r) => r.table_name === 'ricevuti');
  assert.equal(createdRows.length, 1, 'esattamente una riga creata, solo per APP_ID');
  assert.equal(createdRows[0].app_id, APP_ID);
  assert.equal(createdRows[0].tenant_id, TENANT_ID);
});

test('trigger con toState specifico non scatta per una transizione diversa', async () => {
  const workflows = [
    { id: 'wf_pronto', name: 'Solo su pronto', enabled: true,
      trigger: { event: 'state.changed', entity: 'ordini', toState: 'pronto' },
      actions: [{ type: 'update_field', field: 'notificato', value: true }] },
  ];
  const supabase = makeFakeSupabase(baseTables(configWith(workflows)));
  const record = supabase._tables.app_records.find((r) => r.id === 'rec-1');

  const summary = await routeEvent(supabase, {
    type: 'state.changed', appId: APP_ID, tenantId: TENANT_ID, entity: 'ordini', record,
    toState: 'annullato', fromState: 'nuovo',
  });

  assert.equal(summary.matched, 0);
  assert.equal(record.data.notificato, undefined);
});
