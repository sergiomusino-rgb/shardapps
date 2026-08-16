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

const WORKFLOW_TICK_RECORD_LIMIT = 200;
// Ogni 15 minuti: abbastanza reattivo per un promemoria/controllo periodico
// senza avvicinarsi al territorio di un vero scheduler a grana fine (fuori
// perimetro di questa fase).
const SCHEDULE_TICK_CRON = process.env.WORKFLOW_TICK_CRON || '*/15 * * * *';

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
} else {
  console.log('[WorkflowTick] Supabase non configurato - schedule.tick disabilitato');
}

async function tickOnce() {
  if (!supabase) return;
  try {
    // Filtro JSONB economico per restringere il set di righe da esaminare in
    // JS: il vero controllo (enabled + trigger.event==='schedule.tick') resta
    // in loadWorkflows/routeEvent, questo è solo un pre-filtro a livello SQL.
    const { data: apps, error } = await supabase
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
        await routeEvent(supabase, { type: 'schedule.tick', appId: app.id, tenantId: app.tenant_id });
        continue;
      }

      for (const entity of entities) {
        const { data: records, error: recordsError } = await supabase
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
          await routeEvent(supabase, { type: 'schedule.tick', appId: app.id, tenantId: app.tenant_id, entity, record });
        }
      }
    }
  } catch (err) {
    console.error('[WorkflowTick] errore generale:', err);
  }
}

function startWorkflowTick() {
  if (!supabase) {
    console.log('[WorkflowTick] job non avviato (Supabase non configurato)');
    return;
  }
  cron.schedule(SCHEDULE_TICK_CRON, () => {
    tickOnce();
  });
  console.log(`[WorkflowTick] avviato (${SCHEDULE_TICK_CRON})`);
}

module.exports = { startWorkflowTick, tickOnce };
