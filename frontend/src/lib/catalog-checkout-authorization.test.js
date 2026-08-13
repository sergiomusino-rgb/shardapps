// ─── Test della decisione di autorizzazione (App Catalog STEP 4 — checkout) ─
// node:test built-in, nessuna dipendenza nuova, nessuna chiamata di
// rete/DB/Next.js/Supabase/Stripe — copre solo authorizeCatalogCheckout
// (logica pura), stesso pattern di catalog-provision-authorization.test.js.
//
// Uso: node --test src/lib (dalla cartella frontend/), o npm test.

const test = require('node:test');
const assert = require('node:assert/strict');

const { authorizeCatalogCheckout } = require('./catalog-checkout-authorization');

const USER = { id: 'user-1', email: 'user1@example.com' };
const ACTIVE_PRODUCT = { id: 'product-1', slug: 'follow-ai', is_active: true, price_monthly: 29.0 };
const INACTIVE_PRODUCT = { id: 'product-2', slug: 'discontinued-ai', is_active: false, price_monthly: 29.0 };
const FREE_PRODUCT = { id: 'product-3', slug: 'command-ai', is_active: true, price_monthly: 0 };
const TRIAL_INSTANCE = { id: 'app-1', tenant_id: 'tenant-1', status: 'trial', stripe_customer_id: null, stripe_subscription_id: null };
const ACTIVE_INSTANCE = { id: 'app-2', tenant_id: 'tenant-1', status: 'active', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' };
const PAST_DUE_INSTANCE = { id: 'app-3', tenant_id: 'tenant-1', status: 'past_due', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' };

// ─── 401 ────────────────────────────────────────────────────────────────

test('401: nessun token -> "Autenticazione richiesta"', () => {
  const decision = authorizeCatalogCheckout({ token: null, user: null, product: null, instance: null });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 401);
  assert.equal(decision.error, 'Autenticazione richiesta');
  assert.equal(decision.code, 'UNAUTHORIZED');
});

test('401: token presente ma nessun utente risolto -> "Token non valido"', () => {
  const decision = authorizeCatalogCheckout({ token: 'tok', user: null, product: ACTIVE_PRODUCT, instance: TRIAL_INSTANCE });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 401);
  assert.equal(decision.error, 'Token non valido');
  assert.equal(decision.code, 'UNAUTHORIZED');
});

// ─── 404: prodotto ──────────────────────────────────────────────────────

test('404: prodotto inesistente -> "Prodotto non trovato"', () => {
  const decision = authorizeCatalogCheckout({ token: 'tok', user: USER, product: null, instance: null });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 404);
  assert.equal(decision.error, 'Prodotto non trovato');
  assert.equal(decision.code, 'PRODUCT_NOT_FOUND');
});

test('404: prodotto disattivato -> stesso errore/status/code del prodotto inesistente', () => {
  const decision = authorizeCatalogCheckout({ token: 'tok', user: USER, product: INACTIVE_PRODUCT, instance: TRIAL_INSTANCE });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 404);
  assert.equal(decision.error, 'Prodotto non trovato');
  assert.equal(decision.code, 'PRODUCT_NOT_FOUND');
});

// ─── 404: istanza ───────────────────────────────────────────────────────

test('404: nessuna istanza di questo prodotto per il tenant -> "Nessuna istanza..."', () => {
  const decision = authorizeCatalogCheckout({ token: 'tok', user: USER, product: ACTIVE_PRODUCT, instance: null });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 404);
  assert.equal(decision.code, 'INSTANCE_NOT_FOUND');
});

// ─── 400: già attiva ────────────────────────────────────────────────────

test('400: istanza già status=active -> "Abbonamento già attivo", niente secondo checkout', () => {
  const decision = authorizeCatalogCheckout({ token: 'tok', user: USER, product: ACTIVE_PRODUCT, instance: ACTIVE_INSTANCE });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 400);
  assert.equal(decision.code, 'ALREADY_ACTIVE');
});

test('ok: istanza status=past_due può rifare checkout (non è "già attiva")', () => {
  const decision = authorizeCatalogCheckout({ token: 'tok', user: USER, product: ACTIVE_PRODUCT, instance: PAST_DUE_INSTANCE });
  assert.equal(decision.ok, true);
});

// ─── 400: prodotto gratuito ─────────────────────────────────────────────

test('400: price_monthly=0 -> "Questo prodotto non richiede un abbonamento a pagamento"', () => {
  const decision = authorizeCatalogCheckout({ token: 'tok', user: USER, product: FREE_PRODUCT, instance: TRIAL_INSTANCE });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 400);
  assert.equal(decision.code, 'FREE_PRODUCT');
});

// ─── 200 ────────────────────────────────────────────────────────────────

test('ok: prodotto attivo a pagamento + istanza in trial del tenant -> autorizzato', () => {
  const decision = authorizeCatalogCheckout({ token: 'tok', user: USER, product: ACTIVE_PRODUCT, instance: TRIAL_INSTANCE });
  assert.equal(decision.ok, true);
});

// ─── Ordine di priorità dei controlli ──────────────────────────────────

test('priorita: senza token, tutto il resto irrilevante -> resta 401', () => {
  const decision = authorizeCatalogCheckout({ token: null, user: USER, product: ACTIVE_PRODUCT, instance: ACTIVE_INSTANCE });
  assert.equal(decision.status, 401);
  assert.equal(decision.error, 'Autenticazione richiesta');
});

test('priorita: prodotto rifiutato prima di valutare l\'istanza', () => {
  const decision = authorizeCatalogCheckout({ token: 'tok', user: USER, product: INACTIVE_PRODUCT, instance: ACTIVE_INSTANCE });
  assert.equal(decision.status, 404);
  assert.equal(decision.code, 'PRODUCT_NOT_FOUND');
});

// ─── Garanzia strutturale: nessun tenant nella firma ───────────────────
// tenant_id non è (e non può essere) un parametro di questa funzione: la
// route lo risolve da tenant_members(user_id), mai da un valore client, e
// usa quel tenant_id SOLO per scoping della query che produce `instance` —
// questa funzione non lo vede né lo decide mai.
test('garanzia strutturale: authorizeCatalogCheckout non accetta/usa alcun tenantId in input', () => {
  const decision = authorizeCatalogCheckout({
    token: 'tok', user: USER, product: ACTIVE_PRODUCT, instance: TRIAL_INSTANCE,
    tenantId: 'tenant-arbitrario-iniettato-dal-client',
  });
  assert.equal(decision.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(decision, 'tenantId'), false);
});
