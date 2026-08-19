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
// Pre-Beta Hardening, Blocco 7: ogni captureError innesca anche un tentativo
// di alerting (src/lib/alerting.ts) — fire-and-forget, mai un await
// bloccante, mai un'eccezione propagata al chiamante. Import dinamico (non
// in testa al file): questo modulo è importato da moduli usati anche in
// contesti dove alerting.ts non deve essere valutato a freddo (stessa
// cautela già seguita per i require lazy di Resend altrove nel repo).
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

  import('./alerting')
    .then(({ maybeSendAlert }) => maybeSendAlert({ route, message: entry.message, context }))
    .catch(() => {});
}
