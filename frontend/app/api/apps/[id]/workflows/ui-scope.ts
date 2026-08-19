// ─── Automation UI — vocabolario ammesso (condiviso POST + PATCH) ──────────
// Estratto in un modulo a parte (a differenza del pattern auth, duplicato
// apposta in ogni route/[id]/workflows/*, vedi commento in
// [workflowId]/route.ts) perché QUESTA è logica di validazione: due copie
// indipendenti in POST (crea) e PATCH (modifica) rischierebbero di divergere
// nel tempo (es. un'azione ammessa in creazione ma rifiutata in modifica),
// un problema di correttezza/sicurezza, non solo di stile.
//
// Scope volutamente minimo e deliberatamente un SOTTOINSIEME del motore
// reale (backend/lib/workflow-model.js — VALID_EVENTS/VALID_ACTION_TYPES,
// invariato): questa UI non è (e non deve diventare) un workflow builder
// completo. Round 2 (Integrations + Automation level-up) estende lo scope
// esistente (Pre-Beta Hardening, Blocco 5) con http_request e più di
// un'azione per workflow — resta comunque un elenco chiuso.

export const ALLOWED_UI_TRIGGER_EVENTS = new Set(['record.created', 'record.updated', 'state.changed']);
export const ALLOWED_UI_ACTION_TYPES = new Set(['update_field', 'send_notification', 'trigger_webhook', 'http_request']);

// Round 2: da 1 a "almeno 2" azioni per workflow richiesto esplicitamente.
// Il motore ammette fino a 20 (WorkflowSchema.actions.max(20)): questa UI
// resta più conservativa (una sequenza leggibile in una schermata, non un
// editor di uno script arbitrario).
export const MAX_UI_ACTIONS = 5;

export function validateUiScope(input: { trigger?: { event?: unknown }; actions?: Array<{ type?: unknown }> }): string | null {
  const event = input.trigger?.event;
  if (typeof event !== 'string' || !ALLOWED_UI_TRIGGER_EVENTS.has(event)) {
    return `Trigger non supportato da questa interfaccia. Ammessi: ${[...ALLOWED_UI_TRIGGER_EVENTS].join(', ')}`;
  }
  const actions = input.actions;
  if (!Array.isArray(actions) || actions.length === 0) {
    return 'Almeno un\'azione è richiesta';
  }
  if (actions.length > MAX_UI_ACTIONS) {
    return `Questa interfaccia supporta al massimo ${MAX_UI_ACTIONS} azioni per workflow`;
  }
  for (const action of actions) {
    const actionType = action?.type;
    if (typeof actionType !== 'string' || !ALLOWED_UI_ACTION_TYPES.has(actionType)) {
      return `Azione non supportata da questa interfaccia. Ammesse: ${[...ALLOWED_UI_ACTION_TYPES].join(', ')}`;
    }
  }
  return null;
}
