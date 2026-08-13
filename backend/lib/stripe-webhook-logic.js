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

// ─── STEP 4 (App Catalog — billing) ─────────────────────────────────────────
// Vocabolario di apps.subscription_status per una Catalog Instance
// (apps.product_id IS NOT NULL) — stesso CHECK constraint di
// supabase/migrations/20260815000000_app_catalog_core_schema.sql
// ('trialing'|'active'|'past_due'|'canceled'). apps.status resta l'UNICA
// source of truth del lifecycle (decisione STEP 4): ogni valore che
// updateAppStatus scrive su apps.status per il ramo 'app' del webhook
// ('active'|'past_due'|'canceled', mai altro) è già, senza traduzione,
// un membro valido di questo vocabolario — questa funzione esiste solo per
// rendere esplicita/testabile quella coincidenza e per non scrivere mai
// accidentalmente un valore fuori dal CHECK constraint (es. 'trial'/'expired',
// stati che il webhook non emette mai, ma che apps.status può assumere da
// altri percorsi — provisioning, cron legacy).
const CATALOG_SUBSCRIPTION_STATUSES = new Set(['trialing', 'active', 'past_due', 'canceled']);
function resolveCatalogSubscriptionStatus(appStatus) {
  return CATALOG_SUBSCRIPTION_STATUSES.has(appStatus) ? appStatus : null;
}

// Estrae un id Stripe da un campo che può arrivare sia come stringa
// ("cus_...", "sub_...") sia come oggetto espanso ({ id: "cus_..." }), a
// seconda di come Stripe serializza l'evento — stesso pattern già ripetuto
// inline in più punti di stripe-webhook-handler.js (session.subscription,
// session.customer, invoice.customer, subscription.customer): unica fonte di
// verità qui invece di duplicarlo ad ogni call site.
function extractStripeId(value) {
  if (!value) return null;
  return typeof value === 'string' ? value : (value.id || null);
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
    case 'invoice.payment_failed':
      // Dalla ristrutturazione Invoice di Stripe (metà 2025), invoice.subscription
      // non esiste più: l'id sta sotto invoice.parent.subscription_details.subscription.
      // Il fallback sul campo legacy resta per compatibilità con payload più
      // vecchi. Corretto qui il 2026-08-09 (audit Fase 3B): invoice.payment_failed
      // aveva SOLO il campo legacy (asimmetria rispetto a payment_succeeded,
      // preesistente a questa fase) — un payload Stripe già ristrutturato
      // avrebbe fatto ignorare silenziosamente l'evento, senza scrittura né
      // errore visibile. Ora entrambi gli eventi usano lo stesso fallback,
      // nello stesso ordine (campo nuovo prima, legacy come ripiego).
      return eventObject?.parent?.subscription_details?.subscription || eventObject?.subscription || null;
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

// ─── Verifica firma webhook (Fase 3, completamento) ─────────────────────────
// Isolata da backend/server.js per essere testabile: stripe.webhooks.
// constructEvent è verifica HMAC locale (confronta la firma nell'header
// contro payload+secret), NON contatta l'API Stripe — può essere chiamata
// nei test con un'istanza Stripe costruita con una chiave finta, nessun
// mock/rete necessario. Riceve `stripe` (l'istanza già creata in server.js)
// invece di crearne una propria: stesso client, stessa configurazione.
function verifyWebhookSignature(stripe, payload, signature, secret) {
  try {
    const event = stripe.webhooks.constructEvent(payload, signature, secret);
    return { ok: true, event };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Risoluzione piano da nome prodotto Stripe (fallback legacy) ──────────
// Estratta da resolvePlanFromSession (backend/server.js): solo la parte pura
// di pattern-matching sul nome, senza le chiamate Stripe (listLineItems/
// prices.retrieve/products.retrieve) che la precedono. Ritorna null se il
// nome non corrisponde a nessun piano noto — il chiamante decide come
// loggare/gestire esplicitamente il fallback, invece che farlo sparire
// silenziosamente dentro il pattern-matching stesso.
function resolvePlanFromProductName(productName) {
  const name = (productName || '').toLowerCase();
  if (name.includes('business')) return 'business';
  if (name.includes('vip')) return 'vip';
  if (name.includes('pro')) return 'pro';
  if (name.includes('starter')) return 'starter';
  if (name.includes('basic') || name.includes('base')) return 'basic';
  return null;
}

module.exports = {
  PLAN_RANK,
  planRank,
  APP_SUBSCRIPTION_STATUS_MAP,
  resolveAppStatusFromStripeStatus,
  CATALOG_SUBSCRIPTION_STATUSES,
  resolveCatalogSubscriptionStatus,
  extractStripeId,
  isStaleEvent,
  isDuplicateSessionError,
  resolveEventSubscriptionId,
  classifyStripeEvent,
  verifyWebhookSignature,
  resolvePlanFromProductName,
};
