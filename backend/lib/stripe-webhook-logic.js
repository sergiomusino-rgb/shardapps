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
// `lastAppliedAt` è il riferimento temporale dell'ultimo evento/stato già
// applicato alla riga che si sta per sovrascrivere. Se l'evento è più
// vecchio di quel riferimento, va scartato.
//
// Non è sempre updated_at (Fase 3B, indagine sui falsi positivi, 2026-08-09):
// - subscriptions.updated_at va bene com'è — scritta SOLO da codice legato
//   a Stripe (server.js, routes/stripe.js, webhook frontend), nessun altro
//   writer trovato.
// - apps.updated_at NON va bene — scritta da 15+ percorsi non legati a
//   Stripe (cron di scadenza, azioni reseller/cliente, ecc.), e il trigger
//   DB tr_apps_updated_at la sovrascrive su QUALUNQUE update. Per questo
//   updateAppStatus (server.js) passa qui apps.stripe_event_applied_at
//   (20260809000007_add_apps_stripe_event_applied_at.sql), una colonna
//   scritta SOLO dal webhook Stripe, non updated_at.
function isStaleEvent(eventCreatedAt, lastAppliedAt) {
  if (eventCreatedAt == null || !lastAppliedAt) return false; // nessun riferimento -> non può essere fuori ordine

  const eventMs = eventCreatedAt instanceof Date
    ? eventCreatedAt.getTime()
    : Number(eventCreatedAt) * 1000;
  const lastAppliedMs = new Date(lastAppliedAt).getTime();

  if (Number.isNaN(eventMs) || Number.isNaN(lastAppliedMs)) return false; // dato malformato: non blocca l'evento, difensivo

  return eventMs < lastAppliedMs;
}

// Idempotenza (Fase 3B, casi 4/17 — webhook duplicato/retry): vero se
// l'errore Postgres indica un vincolo UNIQUE violato su
// processed_checkout_sessions(session_id) — la sessione/evento è già stata
// processata da un altro percorso (webhook, /sync-plan, un retry Stripe
// dello stesso evento), quindi va trattato come no-op, non come errore reale
// da propagare. Stessa condizione era duplicata in backend/server.js
// (applyCheckoutSessionOnce) e due volte in backend/routes/stripe.js
// (/sync-plan) — unica fonte di verità qui.
function isDuplicateSessionError(error) {
  return !!error && error.code === '23505';
}

// ─── Routing eventi webhook (Fase 3, Priorità 3) ────────────────────────────
// Decide a quale ramo (app-cliente vs reseller) appartiene un evento Stripe,
// PRIMA di qualunque I/O, quando l'evento stesso porta già abbastanza
// informazione per deciderlo. Per checkout.session.completed e
// payment_intent.succeeded è sempre così: metadata/client_reference_id
// bastano da soli (nessuna query necessaria).
//
// Per gli eventi legati a una subscription già esistente
// (invoice.payment_succeeded/failed, customer.subscription.deleted/updated)
// NON è possibile decidere app-vs-reseller senza una query DB reale
// (getAppIdBySubscriptionId in server.js: le tabelle apps/subscriptions non
// condividono mai lo stesso stripe_subscription_id, ma solo il database lo
// sa — nessuna funzione pura può saperlo in anticipo). Per questi 4 eventi
// classifyStripeEvent estrae comunque, pura, l'unica informazione che serve
// a quella query (subscriptionId) e ritorna type:'requires-lookup' — il
// chiamante (server.js) resta responsabile della query e dell'early-exit
// (mantenuto invariato: interrogare prima apps, solo se non trovata
// interrogare subscriptions, per non fare una query Stripe/DB in più per
// ogni evento del ramo già risolto).
function resolveEventSubscriptionId(eventType, eventObject) {
  switch (eventType) {
    case 'invoice.payment_succeeded':
      // Dalla ristrutturazione Invoice di Stripe (metà 2025), invoice.subscription
      // non esiste più: l'id sta sotto invoice.parent.subscription_details.subscription.
      // Il fallback sul campo legacy resta per compatibilità con payload più vecchi.
      return eventObject?.parent?.subscription_details?.subscription || eventObject?.subscription || null;
    case 'invoice.payment_failed':
      // Asimmetria preesistente rispetto a invoice.payment_succeeded: questo
      // ramo, nel codice originale di backend/server.js, non ha mai avuto il
      // fallback su parent.subscription_details.subscription. Riprodotta
      // fedelmente qui (nessun comportamento cambiato da questa estrazione),
      // non è una scelta di design — segnalata perché potrebbe essere un
      // bug preesistente da verificare a parte.
      return eventObject?.subscription || null;
    case 'customer.subscription.deleted':
    case 'customer.subscription.updated':
      return eventObject?.id || null;
    default:
      return null;
  }
}

function classifyStripeEvent(event) {
  const eventType = event?.type;
  const eventObject = event?.data?.object;

  switch (eventType) {
    case 'checkout.session.completed': {
      // Abbonamento app-cliente (paywall trial), creato da
      // /api/a/[slug]/create-checkout-session con metadata.app_id: va
      // controllato PRIMA di client_reference_id, perché per queste sessioni
      // client_reference_id è l'id dell'APP, non del tenant.
      const appId = eventObject?.metadata?.app_id || null;
      if (appId) return { type: 'app', appId };

      const tenantId = eventObject?.client_reference_id || eventObject?.metadata?.tenant_id || null;
      if (tenantId) return { type: 'reseller', tenantId };

      return { type: 'unresolved' };
    }
    case 'payment_intent.succeeded': {
      // Nessun ramo app-cliente per questo evento (mode:'payment' non è
      // usato dal checkout app-cliente, che è sempre mode:'subscription').
      const tenantId = eventObject?.metadata?.tenant_id || null;
      if (tenantId) return { type: 'reseller', tenantId };

      return { type: 'unresolved' };
    }
    case 'invoice.payment_succeeded':
    case 'invoice.payment_failed':
    case 'customer.subscription.deleted':
    case 'customer.subscription.updated': {
      const subscriptionId = resolveEventSubscriptionId(eventType, eventObject);
      if (!subscriptionId) return { type: 'unresolved' };
      return { type: 'requires-lookup', subscriptionId };
    }
    default:
      return { type: 'unhandled' };
  }
}

module.exports = {
  PLAN_RANK,
  planRank,
  APP_SUBSCRIPTION_STATUS_MAP,
  resolveAppStatusFromStripeStatus,
  isStaleEvent,
  isDuplicateSessionError,
  resolveEventSubscriptionId,
  classifyStripeEvent,
};
