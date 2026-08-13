// ─── Error tracking minimale (Product Readiness Audit, P1 — osservabilità) ──
// Stesso principio di backend/lib/error-tracking.js (nessuna dipendenza
// esterna, nessun account/servizio di terze parti): prima di questo modulo
// un fallimento nelle route critiche del motore CreatorAI (generazione,
// pubblicazione, refactor via Copilot, lettura pubblica) produceva solo un
// `console.error` in formato libero — visibile nei log grezzi di Vercel, ma
// non aggregabile né cercabile in modo affidabile.
//
// captureError() non cambia alcun comportamento applicativo (nessuna
// eccezione rilanciata, nessuna risposta HTTP alterata): logga un unico
// oggetto JSON su una riga, con una forma stabile — un unico punto di
// innesto per un'eventuale, futura integrazione con un vero servizio di
// error tracking (Sentry o equivalente), se e quando verrà decisa.
//
// route: identificatore stabile (es. 'creator.publish'), non l'URL completo
// con i parametri (che vanno in `context`).
// context: dati utili al debug (appId, tenantId, entity, ecc.) — MAI
// segreti/credenziali/token: chi chiama resta responsabile di non passarli.
export function captureError(route: string, err: unknown, context: Record<string, unknown> = {}) {
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
