// ─── Beta funnel event stub (Fase 1 — Private Beta reseller) ───────────────
// Nessun sistema di analytics client-side esiste nel repo (nessun
// GA/PostHog/Mixpanel, nessuna chiamata di rete verso un servizio terzo per
// eventi prodotto) — non ne introduciamo uno qui. Stesso principio di
// src/lib/error-tracking.ts (captureError): un solo punto di innesto, zero
// dipendenze nuove, zero chiamate di rete. Quando verrà scelto un provider
// di analytics reale, questa è l'unica funzione da modificare per instradare
// beta_page_view / beta_apply_start / beta_apply_submit — i chiamanti in
// app/beta non cambiano.
export type BetaFunnelEvent = 'beta_page_view' | 'beta_apply_start' | 'beta_apply_submit';

export function trackBetaEvent(event: BetaFunnelEvent, context: Record<string, unknown> = {}) {
  // Solo console, solo fuori produzione: nessun dato lasciato nella console
  // dei visitatori reali finché questo non è collegato a un provider vero.
  if (process.env.NODE_ENV === 'production') return;
  console.debug('[beta-tracking]', event, context);
}
