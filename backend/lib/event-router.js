// ─── Event Router (CreatorAI Engine 2.0, Fase 4) ───────────────────────────
// Punto unico di orchestrazione: riceve un evento, trova i workflow
// applicabili (app.config.workflows, backend/lib/workflow-model.js), valuta
// le condizioni (backend/lib/condition-evaluator.js, modulo puro separato) e
// fa eseguire le azioni (backend/lib/workflow-action-executor.js, che a sua
// volta delega trigger_webhook/send_notification ad action-dispatcher.js).
// Questo file NON valuta condizioni né esegue azioni direttamente — solo
// orchestrazione, per non mischiare le tre responsabilità nello stesso
// modulo (esplicitamente richiesto, Fase 4).
//
// Isolamento tenant/app: ogni evento porta appId/tenantId espliciti, MAI
// dedotti da un workflow di un'altra app — i workflow vengono caricati SOLO
// da app.config dell'app dell'evento stesso (una query WHERE id=appId), non
// esiste alcun modo per un workflow di operare su un'altra app.

const { loadWorkflows } = require('./workflow-model');
const { evaluateCondition } = require('./condition-evaluator');
const { executeWorkflowAction } = require('./workflow-action-executor');
const { buildEntityList, findEntity } = require('./entity-metadata');

// Stessa composizione di custom-tables.js::loadAppEntities (non esportata da
// lì, non importata per non introdurre un accoppiamento tra route e router):
// due query in sola lettura, stesso costo di quelle già esistenti altrove.
async function loadAppConfigAndEntities(supabase, appId, tenantId) {
  const [{ data: appRow }, { data: customDefs }] = await Promise.all([
    supabase.from('apps').select('config').eq('id', appId).eq('tenant_id', tenantId).maybeSingle(),
    supabase.from('app_records').select('id, data')
      .eq('app_id', appId).eq('tenant_id', tenantId).eq('table_name', '_custom_tables'),
  ]);
  const config = appRow?.config || null;
  const entities = config ? buildEntityList(config, customDefs || [], { appId, tenantId }) : [];
  return { config, entities };
}

function triggerMatches(trigger, event) {
  if (trigger.event !== event.type) return false;
  if (trigger.entity && trigger.entity !== event.entity) return false;
  if (trigger.actionId && trigger.actionId !== event.actionId) return false;
  if (trigger.toState && trigger.toState !== event.toState) return false;
  if (trigger.fromState && trigger.fromState !== event.fromState) return false;
  return true;
}

/**
 * Instrada un evento verso i workflow applicabili di UNA app.
 *
 * event: {
 *   type: 'record.created'|'record.updated'|'record.deleted'|'state.changed'
 *         |'user.action'|'schedule.tick'|'webhook.received',
 *   appId, tenantId,           // sempre richiesti: isolamento per app/tenant
 *   entity,                    // nome entità (table_name) coinvolta, se applicabile
 *   record,                    // { id, data } del record coinvolto, se applicabile
 *   actionId?, toState?, fromState?,  // per affinare il match del trigger
 *   actorRole?, actorEmail?,
 * }
 *
 * Ritorna un riepilogo { matched, executed, results[] } — mai lancia: un
 * evento innescato da una CRUD reale (backend/routes/client-app.js) non deve
 * MAI far fallire l'operazione primaria a causa di un workflow rotto,
 * qualunque errore qui viene catturato e restituito nel riepilogo.
 */
async function routeEvent(supabase, event) {
  const summary = { matched: 0, executed: 0, results: [] };
  try {
    if (!event || !event.appId || !event.tenantId || !event.type) {
      return summary; // evento malformato: nessun workflow può corrispondere, silenzioso
    }

    const { config, entities } = await loadAppConfigAndEntities(supabase, event.appId, event.tenantId);
    if (!config) return summary; // app inesistente/non trovata per questo tenant: nessun workflow eseguibile

    const workflows = loadWorkflows(config).filter((w) => w.enabled && triggerMatches(w.trigger, event));
    summary.matched = workflows.length;
    if (workflows.length === 0) return summary;

    const entityDef = event.entity ? findEntity(entities, event.entity) : undefined;

    for (const workflow of workflows) {
      const conditionsSatisfied = evaluateCondition(workflow.conditions, event.record);
      if (!conditionsSatisfied) {
        summary.results.push({ workflowId: workflow.id, skipped: true, reason: 'conditions_not_met' });
        continue;
      }

      for (const action of workflow.actions) {
        try {
          const result = await executeWorkflowAction(supabase, {
            appId: event.appId,
            tenantId: event.tenantId,
            entity: event.entity,
            entityDef,
            record: event.record,
            action,
            workflowId: workflow.id,
            eventType: event.type,
            actorRole: event.actorRole,
            actorEmail: event.actorEmail,
          });
          summary.executed += 1;
          summary.results.push({ workflowId: workflow.id, actionType: action.type, ...result });
        } catch (err) {
          // executeWorkflowAction già non lancia in condizioni normali: questo
          // catch è solo una rete di sicurezza aggiuntiva, mai un punto di
          // fallimento singolo che blocca gli altri workflow/azioni.
          console.error('[event-router] errore imprevisto eseguendo azione di workflow:', err);
          summary.results.push({ workflowId: workflow.id, actionType: action.type, status: 'failed', error: err.message || String(err) });
        }
      }
    }

    return summary;
  } catch (err) {
    console.error('[event-router] errore imprevisto:', err);
    return summary;
  }
}

module.exports = { routeEvent };
