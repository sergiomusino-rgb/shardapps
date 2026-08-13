// ─── Error tracking minimale (Product Readiness Audit, P1 — osservabilità) ──
// Nessuna dipendenza esterna, nessun account/servizio di terze parti: prima
// di questo modulo un fallimento nelle route critiche (azioni di entità,
// dispatch webhook/notification) produceva solo un `console.error` in
// formato libero — visibile nei log grezzi di Render, ma non aggregabile né
// cercabile in modo affidabile (nessuna struttura comune tra le righe).
//
// captureError() non cambia alcun comportamento applicativo (nessuna
// eccezione rilanciata, nessuna risposta HTTP alterata): logga un unico
// oggetto JSON su una riga, con una forma stabile, così che una futura
// integrazione con un vero servizio di error tracking (Sentry o
// equivalente) — se e quando verrà decisa — abbia un unico punto di innesto
// invece di dover toccare ogni singola route una seconda volta.
//
// route: identificatore stabile della route/funzione (es. 'client-app.actions'),
// non l'URL con i parametri (che finiscono in `context`) — permette di
// raggruppare per origine anche senza un servizio esterno.
// context: dati utili al debug (appId, tenantId, recordId, actionId, ecc.) —
// MAI segreti/credenziali: chi chiama questo modulo resta responsabile di
// non passare password/token nel context (stesso principio di data
// minimization già seguito da action-dispatcher.js::buildPayload).
function captureError(route, err, context = {}) {
  const entry = {
    level: 'error',
    route,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    context,
    timestamp: new Date().toISOString(),
  };
  console.error('[error-tracking]', JSON.stringify(entry));
}

module.exports = { captureError };
