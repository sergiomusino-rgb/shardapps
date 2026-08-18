// ─── Workflow Schedule Tick (CreatorAI Engine 2.0, Fase 4) ─────────────────
// Sorgente dell'evento 'schedule.tick' per il Logic/Workflow Engine — stesso
// pattern cron già in produzione in backend/jobs/expiry-check.js (node-cron,
// stessa inizializzazione difensiva di Supabase), NESSUNA coda distribuita:
// un tick periodico che richiama event-router.js per ogni app con almeno un
// workflow schedule.tick abilitato.
//
// Semplificazione deliberata di questa fase (segnalata nel report Fase 4):
// se il trigger di un workflow specifica `entity`, questo job itera i record
// di quell'entità (max WORKFLOW_TICK_RECORD_LIMIT per tick, per non fare una
// query illimitata) e valuta le condizioni per ciascuno — un tick senza
// `entity` esegue il workflow una sola volta, senza contesto di record
// (le condizioni che referenziano un campo risultano sempre false, vedi
// condition-evaluator.js su un record assente). Non è un motore di
// scheduling generico (niente orari per-workflow, niente coda/backoff): un
// solo intervallo fisso per tutta la piattaforma, sufficiente per il volume
// attuale.

const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const { loadWorkflows } = require('../lib/workflow-model');
const { routeEvent } = require('../lib/event-router');
const { withCronLock } = require('../lib/cron-lock');

const WORKFLOW_TICK_RECORD_LIMIT = 200;
// Ogni 15 minuti: abbastanza reattivo per un promemoria/controllo periodico
// senza avvicinarsi al territorio di un vero scheduler a grana fine (fuori
// perimetro di questa fase).
const SCHEDULE_TICK_CRON = process.env.WORKFLOW_TICK_CRON || '*/15 * * * *';
const TICK_BUCKET_MS = 15 * 60 * 1000;

// Pre-Beta Hardening, Blocco 2: vedi lo stesso commento esteso in
// jobs/expiry-check.js — CRON_MODE=external disattiva questo scheduler
// in-process quando il Render Cron Job dedicato (scripts/run-scheduled-jobs.js)
// è attivo, per non far girare lo stesso tick in due posti.
const CRON_MODE = process.env.CRON_MODE || 'in-process';

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
} else {
  console.log('[WorkflowTick] Supabase non configurato - schedule.tick disabilitato');
}

// supabaseClient/deps.routeEvent iniettabili (default: client reale di
// modulo / routeEvent reale) — stesso principio di dependency injection già
// in uso in expiry-check.js::runExpiryCheckOnce, per essere testabile con un
// fake supabase e uno spy su routeEvent senza toccare lo stato di modulo né
// eseguire logica di workflow reale (già coperta a parte da
// event-router.test.js/workflow-action-executor.test.js). tickOnce() senza
// argomenti (chiamata da tickOnceLocked/il cron) si comporta esattamente
// come prima.
async function tickOnce(supabaseClient = supabase, deps = {}) {
  if (!supabaseClient) return;
  const doRouteEvent = deps.routeEvent || routeEvent;
  try {
    // Filtro JSONB economico per restringere il set di righe da esaminare in
    // JS: il vero controllo (enabled + trigger.event==='schedule.tick') resta
    // in loadWorkflows/routeEvent, questo è solo un pre-filtro a livello SQL.
    const { data: apps, error } = await supabaseClient
      .from('apps')
      .select('id, tenant_id, config')
      .not('config->workflows', 'is', null);

    if (error) {
      console.error('[WorkflowTick] errore query app con workflows:', error);
      return;
    }
    if (!apps || apps.length === 0) return;

    for (const app of apps) {
      const workflows = loadWorkflows(app.config).filter((w) => w.enabled && w.trigger.event === 'schedule.tick');
      if (workflows.length === 0) continue;

      // Entità distinte referenziate dai trigger schedule.tick di quest'app,
      // per non ripetere la stessa query record per ogni workflow che le
      // condivide.
      const entities = [...new Set(workflows.map((w) => w.trigger.entity).filter(Boolean))];

      if (entities.length === 0) {
        // Nessuna entity specificata: un solo tick "a vuoto" (nessun record
        // di contesto) — vedi nota in testa al file.
        await doRouteEvent(supabaseClient, { type: 'schedule.tick', appId: app.id, tenantId: app.tenant_id });
        continue;
      }

      for (const entity of entities) {
        const { data: records, error: recordsError } = await supabaseClient
          .from('app_records')
          .select('id, data')
          .eq('app_id', app.id)
          .eq('tenant_id', app.tenant_id)
          .eq('table_name', entity)
          .limit(WORKFLOW_TICK_RECORD_LIMIT);

        if (recordsError) {
          console.error(`[WorkflowTick] errore lettura record entità "${entity}" (app ${app.id}):`, recordsError);
          continue;
        }

        for (const record of records || []) {
          await doRouteEvent(supabaseClient, { type: 'schedule.tick', appId: app.id, tenantId: app.tenant_id, entity, record });
        }
      }
    }
  } catch (err) {
    console.error('[WorkflowTick] errore generale:', err);
  }
}

// Bucket temporale di 15 minuti (indipendente dall'espressione cron esatta,
// vedi lib/cron-lock.js): identifica la finestra di esecuzione per il lock,
// così due fonti (in-process + Render Cron Job dedicato) che sparano vicino
// allo stesso istante non eseguono mai due volte lo stesso tick.
function currentTickBucketKey() {
  return String(Math.floor(Date.now() / TICK_BUCKET_MS));
}

async function tickOnceLocked() {
  if (!supabase) return;
  await withCronLock(supabase, 'workflow-tick', currentTickBucketKey(), tickOnce);
}

function startWorkflowTick() {
  if (!supabase) {
    console.log('[WorkflowTick] job non avviato (Supabase non configurato)');
    return;
  }
  if (CRON_MODE === 'external') {
    console.log('[WorkflowTick] scheduler in-process disattivato (CRON_MODE=external) — gestito dal Render Cron Job dedicato');
    return;
  }
  cron.schedule(SCHEDULE_TICK_CRON, () => {
    tickOnceLocked();
  });
  console.log(`[WorkflowTick] avviato (${SCHEDULE_TICK_CRON})`);
}

module.exports = { startWorkflowTick, tickOnce, tickOnceLocked, currentTickBucketKey };
