// ─── Workflow Action Executor (CreatorAI Engine 2.0, Fase 4) ───────────────
// Esegue UNA azione di workflow già normalizzata (workflow-model.js).
//
// trigger_webhook/send_notification vengono SEMPRE delegate a
// action-dispatcher.js — punto centrale unico per le azioni esterne (SSRF
// guard incluso), MAI duplicato qui, esattamente come per le azioni dirette
// via pulsante entità (backend/routes/client-app.js).
//
// change_state/update_field/create_related_record sono nuove, proprie del
// workflow engine (nessun pulsante utente le innesca oggi): eseguite qui con
// un retry sincrono e limitato (MAX_SYNC_RETRIES tentativi extra, solo su
// errore del database, mai su un fallimento di validazione — riprovare una
// transizione di stato non ammessa non la renderebbe ammessa).
//
// Ogni esecuzione produce SEMPRE una riga in app_action_logs (via lo stesso
// logAction di action-dispatcher.js) e non lancia mai: un'azione fallita non
// deve mai interrompere le azioni successive dello stesso workflow né gli
// altri workflow innescati dallo stesso evento (vedi event-router.js).

const { dispatchAppAction, logAction } = require('./action-dispatcher');

const MAX_SYNC_RETRIES = 2;

async function withBoundedRetry(fn) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_SYNC_RETRIES; attempt++) {
    try {
      const result = await fn();
      return { result, retryCount: attempt };
    } catch (err) {
      lastError = err;
    }
  }
  const err = lastError instanceof Error ? lastError : new Error(String(lastError));
  err.retryCount = MAX_SYNC_RETRIES;
  throw err;
}

async function executeChangeState(supabase, { appId, tenantId, entityDef, record, action }) {
  const stateField = (entityDef?.fields || []).find((f) => f.type === 'state');
  if (!stateField) {
    return { status: 'failed', error: `L'entità non ha un campo di tipo "state"`, retryCount: 0 };
  }
  const currentState = record?.data?.[stateField.id];
  const allowed = stateField.allowedTransitions;
  if (allowed && currentState && allowed[currentState] && !allowed[currentState].includes(action.targetState)) {
    // Fallimento di validazione, mai un errore transitorio: nessun retry ha senso qui.
    return { status: 'failed', error: `Transizione non ammessa da "${currentState}" a "${action.targetState}"`, retryCount: 0 };
  }

  try {
    const { retryCount } = await withBoundedRetry(async () => {
      const updatedData = { ...(record?.data || {}), [stateField.id]: action.targetState };
      const { error } = await supabase
        .from('app_records')
        .update({ data: updatedData, updated_at: new Date().toISOString() })
        .eq('id', record.id)
        .eq('app_id', appId)
        .eq('tenant_id', tenantId);
      if (error) throw error;
    });
    return { status: 'delivered', payload: { fromState: currentState, targetState: action.targetState }, retryCount };
  } catch (err) {
    return { status: 'failed', error: err.message || String(err), retryCount: err.retryCount ?? MAX_SYNC_RETRIES };
  }
}

async function executeUpdateField(supabase, { appId, tenantId, record, action }) {
  try {
    const { retryCount } = await withBoundedRetry(async () => {
      const updatedData = { ...(record?.data || {}), [action.field]: action.value };
      const { error } = await supabase
        .from('app_records')
        .update({ data: updatedData, updated_at: new Date().toISOString() })
        .eq('id', record.id)
        .eq('app_id', appId)
        .eq('tenant_id', tenantId);
      if (error) throw error;
    });
    return { status: 'delivered', payload: { field: action.field, value: action.value }, retryCount };
  } catch (err) {
    return { status: 'failed', error: err.message || String(err), retryCount: err.retryCount ?? MAX_SYNC_RETRIES };
  }
}

async function executeCreateRelatedRecord(supabase, { appId, tenantId, record, action }) {
  const relatedData = {};
  for (const [targetField, sourceField] of Object.entries(action.fieldMapping || {})) {
    relatedData[targetField] = record?.data?.[sourceField];
  }
  try {
    const { retryCount } = await withBoundedRetry(async () => {
      const { error } = await supabase
        .from('app_records')
        .insert({ app_id: appId, tenant_id: tenantId, table_name: action.targetEntity, data: relatedData });
      if (error) throw error;
    });
    return { status: 'delivered', payload: { targetEntity: action.targetEntity, data: relatedData }, retryCount };
  } catch (err) {
    return { status: 'failed', error: err.message || String(err), retryCount: err.retryCount ?? MAX_SYNC_RETRIES };
  }
}

/**
 * Esegue una singola azione di workflow (già normalizzata da
 * workflow-model.js::normalizeAction) e registra sempre il risultato.
 * ctx: { appId, tenantId, entity, entityDef, record, action, workflowId,
 * eventType, actorRole?, actorEmail? } — entityDef è la definizione unificata
 * dell'entità (backend/lib/entity-metadata.js::findEntity), serve solo per
 * change_state (per trovare il campo `state` e le sue allowedTransitions).
 * Non lancia mai.
 */
async function executeWorkflowAction(supabase, ctx) {
  const { appId, tenantId, entity, entityDef, record, action, workflowId, eventType, actorRole, actorEmail } = ctx;
  const logCtx = { appId, tenantId, recordId: record?.id, entity, action, workflowId, eventType, actorRole, actorEmail };

  try {
    if (action.type === 'trigger_webhook' || action.type === 'send_notification') {
      // Delega al punto centrale unico — mai duplicato qui, logging incluso.
      return await dispatchAppAction(supabase, {
        appId, tenantId, recordId: record?.id, entity, action, actorRole, actorEmail,
        workflowId, eventType, record,
        notification: action.type === 'send_notification' ? action : undefined,
      });
    }

    let result;
    if (action.type === 'change_state') {
      result = await executeChangeState(supabase, { appId, tenantId, entityDef, record, action });
    } else if (action.type === 'update_field') {
      result = await executeUpdateField(supabase, { appId, tenantId, record, action });
    } else if (action.type === 'create_related_record') {
      result = await executeCreateRelatedRecord(supabase, { appId, tenantId, record, action });
    } else {
      result = { status: 'failed', error: `Tipo azione non gestito: ${action.type}`, retryCount: 0 };
    }

    await logAction(supabase, { ...logCtx, status: result.status, payload: result.payload, error: result.error, retryCount: result.retryCount });
    return result;
  } catch (err) {
    // Rete di sicurezza finale: un'eccezione imprevista in uno dei rami sopra
    // non deve mai propagarsi all'event router, che deve poter proseguire
    // con le azioni/workflow successivi.
    console.error('[workflow-action-executor] errore imprevisto:', err);
    const result = { status: 'failed', error: err.message || String(err) };
    await logAction(supabase, { ...logCtx, ...result }).catch(() => {});
    return result;
  }
}

module.exports = { executeWorkflowAction, MAX_SYNC_RETRIES };
