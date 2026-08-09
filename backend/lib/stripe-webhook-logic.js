// ─── Logica pura del webhook Stripe (decisioni, nessun I/O) ────────────────
// Estratta da backend/server.js e backend/routes/stripe.js (Fase 3, Step 3:
// difesa in profondità sul billing) per due motivi:
// 1) planRank/PLAN_RANK erano duplicati identici in entrambi i file — unica
//    fonte di verità qui, importata da entrambi.
// 2) Rendere testabile con node:test (stesso pattern di
//    backend/scripts/check_rls_policies.js, Fase 2) senza Stripe/Supabase
//    reali: nessuna di queste funzioni fa una chiamata di rete o DB.

// Rango dei piani: gli eventi Stripe (webhook, /sync-plan, banner dashboard)
// non arrivano garantiti in ordine cronologico. Se un tenant compra business
// e poi (per un evento in ritardo) arriva l'evento del vecchio acquisto
// starter, un update incondizionato di tenants.plan lo farebbe retrocedere.
// Si applica solo un piano pari o superiore a quello già salvato.
const PLAN_RANK = { free: 0, starter: 1, basic: 1, pro: 2, business: 3, vip: 3 };
function planRank(plan) {
  return PLAN_RANK[plan] ?? 0;
}

// Mappa lo status subscription di Stripe allo status apps.status (paywall
// trial cliente finale). Stessa mappa già in uso (dormiente) in
// frontend/app/api/webhooks/stripe/route.ts::handleAppSubscriptionUpdated.
const APP_SUBSCRIPTION_STATUS_MAP = {
  active: 'active',
  trialing: 'active',
  past_due: 'past_due',
  unpaid: 'past_due',
  incomplete: 'past_due',
  incomplete_expired: 'canceled',
  canceled: 'canceled',
};
function resolveAppStatusFromStripeStatus(stripeStatus) {
  return APP_SUBSCRIPTION_STATUS_MAP[stripeStatus] || null;
}

// Protezione eventi fuori ordine (Fase 3B, caso 13): Stripe non garantisce
// la consegna in ordine cronologico degli eventi webhook. `eventCreatedAt`
// è il campo `created` dell'Event Stripe (secondi Unix, sempre presente);
// `rowUpdatedAt` è il valore già salvato in `updated_at` sulla riga
// (subscriptions/apps) che si sta per sovrascrivere. Se l'evento è più
// vecchio dell'ultimo aggiornamento già registrato, va scartato: qualunque
// cosa abbia scritto quell'updated_at riflette già una realtà successiva a
// questo evento.
//
// Nessuna nuova colonna richiesta: updated_at esiste già su entrambe le
// tabelle ed è già scritto ad ogni update — qui viene solo letto prima di
// scrivere, non aggiunta struttura al DB.
function isStaleEvent(eventCreatedAt, rowUpdatedAt) {
  if (eventCreatedAt == null || !rowUpdatedAt) return false; // nessun riferimento -> non può essere fuori ordine

  const eventMs = eventCreatedAt instanceof Date
    ? eventCreatedAt.getTime()
    : Number(eventCreatedAt) * 1000;
  const rowMs = new Date(rowUpdatedAt).getTime();

  if (Number.isNaN(eventMs) || Number.isNaN(rowMs)) return false; // dato malformato: non blocca l'evento, difensivo

  return eventMs < rowMs;
}

module.exports = {
  PLAN_RANK,
  planRank,
  APP_SUBSCRIPTION_STATUS_MAP,
  resolveAppStatusFromStripeStatus,
  isStaleEvent,
};
