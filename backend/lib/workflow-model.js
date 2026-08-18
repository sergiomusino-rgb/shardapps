// ─── Workflow Model — normalizzazione (CreatorAI Engine 2.0, Fase 4) ───────
// Stesso principio di lib/entity-metadata.js: nessuna dipendenza zod nel
// backend (plain CommonJS, il frontend è l'unico a usare zod). Normalizza
// `apps.config.workflows` (scritto/validato lato frontend da
// frontend/src/lib/site-schema.ts::WorkflowSchema) in una forma canonica
// difensiva — un JSON malformato/manomesso non deve mai far esplodere
// l'event router, solo degradare (workflow scartato) invece di eseguirlo con
// dati a metà.

const VALID_EVENTS = new Set([
  'record.created', 'record.updated', 'record.deleted',
  'state.changed', 'user.action', 'schedule.tick', 'webhook.received',
]);

const VALID_ACTION_TYPES = new Set([
  'change_state', 'trigger_webhook', 'send_notification', 'update_field', 'create_related_record',
  // http_request (Integrations — Pre-Beta Hardening Round 2): azione HTTP
  // generica (URL/metodo/header/body configurabili), a differenza di
  // trigger_webhook (sempre POST, payload fisso). Stessa barriera SSRF di
  // trigger_webhook, applicata ad ogni tentativo dal dispatcher, mai qui.
  'http_request',
]);

// Metodi HTTP ammessi per http_request — stesso principio di
// VALID_ACTION_TYPES: un vocabolario chiuso, mai una stringa arbitraria
// passata al fetch.
const VALID_HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

function toId(value, fallback) {
  if (value == null) return fallback;
  const id = String(value).toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return id || fallback;
}

function normalizeTrigger(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!VALID_EVENTS.has(raw.event)) return null;
  return {
    event: raw.event,
    entity: typeof raw.entity === 'string' && raw.entity ? raw.entity : undefined,
    actionId: typeof raw.actionId === 'string' && raw.actionId ? raw.actionId : undefined,
    toState: typeof raw.toState === 'string' && raw.toState ? raw.toState : undefined,
    fromState: typeof raw.fromState === 'string' && raw.fromState ? raw.fromState : undefined,
  };
}

function normalizeAction(raw) {
  if (!raw || typeof raw !== 'object' || !VALID_ACTION_TYPES.has(raw.type)) return null;
  const { type } = raw;

  if (type === 'change_state') {
    if (typeof raw.targetState !== 'string' || !raw.targetState) return null;
    return { type, targetState: raw.targetState };
  }
  if (type === 'trigger_webhook') {
    // La validazione "ovvia" dell'URL (prefisso http(s), non un IP privato
    // letterale) resta quella già scritta in site-schema.ts al salvataggio;
    // la barriera autoritativa (risoluzione DNS reale) resta ssrf-guard.js,
    // invocata da action-dispatcher.js ad ogni esecuzione — non ridotta qui.
    return { type, webhookUrl: typeof raw.webhookUrl === 'string' ? raw.webhookUrl : undefined };
  }
  if (type === 'http_request') {
    if (typeof raw.url !== 'string' || !raw.url) return null;
    const method = typeof raw.method === 'string' && VALID_HTTP_METHODS.has(raw.method.toUpperCase())
      ? raw.method.toUpperCase()
      : 'POST';
    // headers: whitelist libera lato forma, la sanificazione autoritativa
    // (mai Host/Content-Length/Content-Type) resta in action-dispatcher.js
    // al momento dell'esecuzione — stesso principio di SSRF guard sopra.
    const headers = raw.headers && typeof raw.headers === 'object' && !Array.isArray(raw.headers)
      ? Object.fromEntries(Object.entries(raw.headers).filter(([k, v]) => typeof k === 'string' && typeof v === 'string'))
      : {};
    return { type, url: raw.url, method, headers, body: typeof raw.body === 'string' ? raw.body : undefined };
  }
  if (type === 'send_notification') {
    return {
      type,
      recipient: raw.recipient === 'record_field' ? 'record_field' : 'app_owner',
      recipientField: typeof raw.recipientField === 'string' ? raw.recipientField : undefined,
      subject: typeof raw.subject === 'string' ? raw.subject : undefined,
      message: typeof raw.message === 'string' ? raw.message : undefined,
      label: typeof raw.label === 'string' ? raw.label : 'Notifica',
      id: toId(raw.id, 'notifica'),
    };
  }
  if (type === 'update_field') {
    if (typeof raw.field !== 'string' || !raw.field) return null;
    return { type, field: raw.field, value: raw.value, label: typeof raw.label === 'string' ? raw.label : 'Aggiorna campo', id: toId(raw.id, 'aggiorna_campo') };
  }
  if (type === 'create_related_record') {
    if (typeof raw.targetEntity !== 'string' || !raw.targetEntity) return null;
    const fieldMapping = raw.fieldMapping && typeof raw.fieldMapping === 'object' && !Array.isArray(raw.fieldMapping)
      ? raw.fieldMapping
      : {};
    return { type, targetEntity: raw.targetEntity, fieldMapping, label: typeof raw.label === 'string' ? raw.label : 'Crea record collegato', id: toId(raw.id, 'crea_record') };
  }
  return null;
}

function normalizeWorkflow(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const trigger = normalizeTrigger(raw.trigger);
  if (!trigger) return null;

  const actions = Array.isArray(raw.actions) ? raw.actions.map(normalizeAction).filter(Boolean) : [];
  if (actions.length === 0) return null; // un workflow senza azioni valide non ha alcun effetto: scartato, non eseguito a vuoto

  return {
    id: toId(raw.id, `workflow_${index}`),
    name: typeof raw.name === 'string' && raw.name ? raw.name : 'Workflow',
    enabled: raw.enabled !== false, // default true, stessa convenzione di enabled assente = attivo
    trigger,
    // conditions non normalizzate qui in profondità: la FORMA (foglia vs
    // gruppo AND/OR) è verificata a runtime da condition-evaluator.js, che è
    // già fail-closed su qualunque nodo malformato — normalizzarla due volte
    // sarebbe la stessa validazione duplicata in due posti.
    conditions: raw.conditions && typeof raw.conditions === 'object' ? raw.conditions : undefined,
    actions,
  };
}

/**
 * Estrae ed elenca i workflow validi/abilitati da una config app
 * (`apps.config`, qualunque sia il motore che l'ha generata — v1/v2/gestionale
 * sono tutti compatibili perché `workflows` è un campo opzionale allo stesso
 * livello di `adminPanel`/`schema`, MAI dentro FieldSchema). Un workflow
 * malformato viene scartato silenziosamente (mai un errore che blocchi gli
 * altri workflow validi della stessa app).
 */
function loadWorkflows(appConfig) {
  const raw = Array.isArray(appConfig && appConfig.workflows) ? appConfig.workflows : [];
  return raw.map(normalizeWorkflow).filter(Boolean);
}

module.exports = {
  loadWorkflows,
  normalizeWorkflow,
  normalizeTrigger,
  normalizeAction,
  VALID_EVENTS,
  VALID_ACTION_TYPES,
  VALID_HTTP_METHODS,
};
