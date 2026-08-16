// ─── Test dell'Action Engine (workflow-action-executor.js, Fase 4) ─────────
// Nessuna vera rete/DB: fake-supabase.js (in memoria) + RESEND_API_KEY non
// impostata nell'ambiente di test (comportamento reale, non un mock: senza
// quella env var action-dispatcher.js non inizializza Resend, esattamente
// come in qualunque ambiente senza il provider configurato — stesso
// principio "mai una vera chiamata esterna nei test automatici" di
// ssrf-guard.test.js/condition-evaluator.test.js).
//
// Uso: node --test lib (da backend/).

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeSupabase } = require('./test-helpers/fake-supabase');
const { executeWorkflowAction, MAX_SYNC_RETRIES } = require('./workflow-action-executor');

const APP_ID = 'app-1';
const TENANT_ID = 'tenant-1';
const OTHER_APP_ID = 'app-2';
const OTHER_TENANT_ID = 'tenant-2';

function baseTables() {
  return {
    apps: [
      { id: APP_ID, tenant_id: TENANT_ID, client_email: 'owner@app1.test', name: 'App Uno', config: {} },
      { id: OTHER_APP_ID, tenant_id: OTHER_TENANT_ID, client_email: 'owner@app2.test', name: 'App Due', config: {} },
    ],
    app_records: [
      { id: 'rec-1', app_id: APP_ID, tenant_id: TENANT_ID, table_name: 'ordini', data: { stato: 'nuovo', cliente_email: 'cliente@esempio.it' } },
    ],
    app_action_logs: [],
  };
}

const ENTITY_DEF = {
  name: 'ordini',
  fields: [
    { id: 'id', type: 'id' },
    { id: 'stato', type: 'state', states: ['nuovo', 'in_lavorazione', 'consegnato'], allowedTransitions: { nuovo: ['in_lavorazione'], in_lavorazione: ['consegnato'] } },
  ],
};

function getRecord(supabase, id) {
  return supabase._tables.app_records.find((r) => r.id === id);
}

// ─── change_state ────────────────────────────────────────────────────────

test('change_state: transizione ammessa -> delivered, record aggiornato, loggato', async () => {
  const supabase = makeFakeSupabase(baseTables());
  const record = getRecord(supabase, 'rec-1');

  const result = await executeWorkflowAction(supabase, {
    appId: APP_ID, tenantId: TENANT_ID, entity: 'ordini', entityDef: ENTITY_DEF, record,
    action: { type: 'change_state', targetState: 'in_lavorazione' },
    workflowId: 'wf1', eventType: 'record.created',
  });

  assert.equal(result.status, 'delivered');
  assert.equal(getRecord(supabase, 'rec-1').data.stato, 'in_lavorazione');
  assert.equal(supabase._tables.app_action_logs.length, 1);
  assert.equal(supabase._tables.app_action_logs[0].workflow_id, 'wf1');
  assert.equal(supabase._tables.app_action_logs[0].event_type, 'record.created');
  assert.equal(supabase._tables.app_action_logs[0].status, 'delivered');
});

test('change_state: transizione NON ammessa -> failed, record invariato, nessun retry (retry_count 0)', async () => {
  const supabase = makeFakeSupabase(baseTables());
  const record = getRecord(supabase, 'rec-1');

  const result = await executeWorkflowAction(supabase, {
    appId: APP_ID, tenantId: TENANT_ID, entity: 'ordini', entityDef: ENTITY_DEF, record,
    action: { type: 'change_state', targetState: 'consegnato' }, // nuovo -> consegnato non ammessa
    workflowId: 'wf1', eventType: 'record.created',
  });

  assert.equal(result.status, 'failed');
  assert.match(result.error, /Transizione non ammessa/);
  assert.equal(getRecord(supabase, 'rec-1').data.stato, 'nuovo'); // invariato
  assert.equal(supabase._tables.app_action_logs[0].retry_count, 0);
});

// ─── update_field ────────────────────────────────────────────────────────

test('update_field: aggiorna il campo indicato -> delivered', async () => {
  const supabase = makeFakeSupabase(baseTables());
  const record = getRecord(supabase, 'rec-1');

  const result = await executeWorkflowAction(supabase, {
    appId: APP_ID, tenantId: TENANT_ID, entity: 'ordini', record,
    action: { type: 'update_field', field: 'priorita', value: 'alta' },
    workflowId: 'wf2', eventType: 'state.changed',
  });

  assert.equal(result.status, 'delivered');
  assert.equal(getRecord(supabase, 'rec-1').data.priorita, 'alta');
});

// ─── create_related_record ───────────────────────────────────────────────

test('create_related_record: crea un record nella entità target con i campi mappati', async () => {
  const supabase = makeFakeSupabase(baseTables());
  const record = getRecord(supabase, 'rec-1');

  const result = await executeWorkflowAction(supabase, {
    appId: APP_ID, tenantId: TENANT_ID, entity: 'ordini', record,
    action: { type: 'create_related_record', targetEntity: 'notifiche', fieldMapping: { destinatario: 'cliente_email' } },
    workflowId: 'wf3', eventType: 'record.created',
  });

  assert.equal(result.status, 'delivered');
  const created = supabase._tables.app_records.find((r) => r.table_name === 'notifiche');
  assert.ok(created);
  assert.equal(created.data.destinatario, 'cliente@esempio.it');
  assert.equal(created.app_id, APP_ID);
  assert.equal(created.tenant_id, TENANT_ID);
});

// ─── trigger_webhook / send_notification: delegate ad action-dispatcher.js ─

test('trigger_webhook: URL privato/riservato bloccato dall\'SSRF guard (invariato) -> failed', async () => {
  const supabase = makeFakeSupabase(baseTables());
  const record = getRecord(supabase, 'rec-1');

  const result = await executeWorkflowAction(supabase, {
    appId: APP_ID, tenantId: TENANT_ID, entity: 'ordini', record,
    action: { id: 'wh1', label: 'Webhook', type: 'trigger_webhook', webhookUrl: 'http://127.0.0.1:9999/hook' },
    workflowId: 'wf4', eventType: 'record.created',
  });

  assert.equal(result.dispatched, false);
  assert.equal(result.blocked, true);
  const log = supabase._tables.app_action_logs.find((l) => l.workflow_id === 'wf4');
  assert.equal(log.status, 'failed');
  assert.match(log.error, /SSRF guard/);
});

test('send_notification (recipient: app_owner, Resend non configurato nell\'ambiente di test) -> dispatched ma non delivered, mai un errore che rompe il workflow', async () => {
  const supabase = makeFakeSupabase(baseTables());
  const record = getRecord(supabase, 'rec-1');

  const result = await executeWorkflowAction(supabase, {
    appId: APP_ID, tenantId: TENANT_ID, entity: 'ordini', record,
    action: { id: 'notif1', label: 'Notifica', type: 'send_notification', recipient: 'app_owner' },
    workflowId: 'wf5', eventType: 'record.created',
  });

  assert.equal(result.dispatched, true);
  assert.equal(result.delivered, false); // RESEND_API_KEY assente in questo ambiente di test
  const log = supabase._tables.app_action_logs.find((l) => l.workflow_id === 'wf5');
  assert.equal(log.status, 'dispatched');
});

test('send_notification (recipient: record_field, campo assente sul record) -> failed, MAI un invio a un destinatario indovinato', async () => {
  const supabase = makeFakeSupabase(baseTables());
  const record = getRecord(supabase, 'rec-1');

  const result = await executeWorkflowAction(supabase, {
    appId: APP_ID, tenantId: TENANT_ID, entity: 'ordini', record,
    action: { id: 'notif2', label: 'Notifica cliente', type: 'send_notification', recipient: 'record_field', recipientField: 'campo_mai_esistito' },
    workflowId: 'wf6', eventType: 'record.created',
  });

  assert.equal(result.dispatched, false);
  const log = supabase._tables.app_action_logs.find((l) => l.workflow_id === 'wf6');
  assert.equal(log.status, 'failed');
});

// ─── isolamento app/tenant (Security) ───────────────────────────────────────

test('change_state: il filtro app_id/tenant_id impedisce di aggiornare un record di un\'altra app anche a parità di record.id', async () => {
  const tables = baseTables();
  // Stesso id di record, ma appartenente all'altra app/tenant.
  tables.app_records.push({ id: 'rec-1', app_id: OTHER_APP_ID, tenant_id: OTHER_TENANT_ID, table_name: 'ordini', data: { stato: 'nuovo' } });
  const supabase = makeFakeSupabase(tables);
  const record = { id: 'rec-1', data: { stato: 'nuovo' } }; // il chiamante crede sia il record dell'APP_ID

  await executeWorkflowAction(supabase, {
    appId: APP_ID, tenantId: TENANT_ID, entity: 'ordini', entityDef: ENTITY_DEF, record,
    action: { type: 'change_state', targetState: 'in_lavorazione' },
    workflowId: 'wf7', eventType: 'record.created',
  });

  // Solo la riga di APP_ID/TENANT_ID deve essere stata toccata.
  const own = supabase._tables.app_records.find((r) => r.id === 'rec-1' && r.app_id === APP_ID);
  const other = supabase._tables.app_records.find((r) => r.id === 'rec-1' && r.app_id === OTHER_APP_ID);
  assert.equal(own.data.stato, 'in_lavorazione');
  assert.equal(other.data.stato, 'nuovo'); // invariato: mai toccato
});

// ─── retry limit ─────────────────────────────────────────────────────────

test('retry: un errore persistente su update_field si ferma dopo MAX_SYNC_RETRIES tentativi extra (nessun retry infinito)', async () => {
  const supabase = makeFakeSupabase(baseTables());
  const record = getRecord(supabase, 'rec-1');
  let attempts = 0;
  // Sostituisce update con una versione che fallisce sempre, per contare i tentativi.
  const originalFrom = supabase.from.bind(supabase);
  supabase.from = (name) => {
    const builder = originalFrom(name);
    if (name === 'app_records') {
      const originalUpdate = builder.update.bind(builder);
      builder.update = (obj) => {
        attempts += 1;
        const b = originalUpdate(obj);
        const originalThen = b.then.bind(b);
        b.then = (resolve, reject) => originalThen(() => resolve({ data: null, error: { message: 'errore simulato' } }), reject);
        return b;
      };
    }
    return builder;
  };

  const result = await executeWorkflowAction(supabase, {
    appId: APP_ID, tenantId: TENANT_ID, entity: 'ordini', record,
    action: { type: 'update_field', field: 'x', value: 'y' },
    workflowId: 'wf8', eventType: 'record.created',
  });

  assert.equal(result.status, 'failed');
  assert.equal(attempts, MAX_SYNC_RETRIES + 1); // tentativo iniziale + retry, mai di più
  assert.equal(result.retryCount, MAX_SYNC_RETRIES);
});
