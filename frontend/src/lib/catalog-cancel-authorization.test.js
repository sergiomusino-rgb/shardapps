// ─── Test della decisione di autorizzazione (App Catalog STEP 4 — cancel) ──
// node:test built-in, nessuna dipendenza nuova, nessuna chiamata di
// rete/DB/Next.js/Supabase/Stripe — copre solo authorizeCatalogCancel
// (logica pura), stesso pattern di cancel-subscription-authorization.test.js
// e catalog-checkout-authorization.test.js.
//
// Uso: node --test src/lib (dalla cartella frontend/), o npm test.

const test = require('node:test');
const assert = require('node:assert/strict');

const { authorizeCatalogCancel } = require('./catalog-cancel-authorization');

const USER = { id: 'user-1' };
const ACTIVE_INSTANCE = { id: 'app-1', tenant_id: 'tenant-1', product_id: 'product-1', status: 'active', stripe_subscription_id: 'sub_1' };
const NO_SUB_INSTANCE = { id: 'app-2', tenant_id: 'tenant-1', product_id: 'product-1', status: 'trial', stripe_subscription_id: null };
const NON_CATALOG_INSTANCE = { id: 'app-3', tenant_id: 'tenant-1', product_id: null, status: 'active', stripe_subscription_id: 'sub_3' };

// ─── 401 ────────────────────────────────────────────────────────────────

test('401: nessun token -> "Autenticazione richiesta"', () => {
  const decision = authorizeCatalogCancel({ token: null, user: null, instance: null });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 401);
  assert.equal(decision.error, 'Autenticazione richiesta');
  assert.equal(decision.code, 'UNAUTHORIZED');
});

test('401: token presente ma nessun utente risolto -> "Token non valido"', () => {
  const decision = authorizeCatalogCancel({ token: 'tok', user: null, instance: ACTIVE_INSTANCE });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 401);
  assert.equal(decision.error, 'Token non valido');
  assert.equal(decision.code, 'UNAUTHORIZED');
});

// ─── 404: istanza ───────────────────────────────────────────────────────
// (copre implicitamente sia "non esiste" sia "esiste ma di un altro
// tenant": la route non passa mai `instance` in quest'ultimo caso, la query
// che la produce è già scoped per tenant_id — vedi commento nel route.ts)

test('404: nessuna istanza trovata per questo tenant+prodotto -> "Istanza non trovata"', () => {
  const decision = authorizeCatalogCancel({ token: 'tok', user: USER, instance: null });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 404);
  assert.equal(decision.code, 'INSTANCE_NOT_FOUND');
});

// ─── 400: non è una Catalog Instance ────────────────────────────────────

test('400: istanza senza product_id -> non è una Catalog Instance, questo endpoint non la gestisce', () => {
  const decision = authorizeCatalogCancel({ token: 'tok', user: USER, instance: NON_CATALOG_INSTANCE });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 400);
  assert.equal(decision.code, 'NOT_CATALOG_INSTANCE');
});

// ─── 400: nessun abbonamento da cancellare ──────────────────────────────

test('400: istanza senza stripe_subscription_id -> "Nessun abbonamento attivo da cancellare"', () => {
  const decision = authorizeCatalogCancel({ token: 'tok', user: USER, instance: NO_SUB_INSTANCE });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 400);
  assert.equal(decision.code, 'NO_ACTIVE_SUBSCRIPTION');
});

// ─── 200 ────────────────────────────────────────────────────────────────

test('ok: istanza del tenant con subscription attiva -> autorizzato', () => {
  const decision = authorizeCatalogCancel({ token: 'tok', user: USER, instance: ACTIVE_INSTANCE });
  assert.equal(decision.ok, true);
});

// ─── Ordine di priorità dei controlli ──────────────────────────────────

test('priorita: senza token, istanza irrilevante -> resta 401', () => {
  const decision = authorizeCatalogCancel({ token: null, user: USER, instance: ACTIVE_INSTANCE });
  assert.equal(decision.status, 401);
  assert.equal(decision.error, 'Autenticazione richiesta');
});

// ─── Garanzia strutturale: nessun tenant nella firma ───────────────────
// tenant_id non è un parametro di questa funzione: `instance` arriva già
// scoped per tenant dalla route (tenant_members(user_id), mai un valore
// client) — un'istanza di un altro tenant non può mai essere passata qui.
test('garanzia strutturale: authorizeCatalogCancel non accetta/usa alcun tenantId in input', () => {
  const decision = authorizeCatalogCancel({
    token: 'tok', user: USER, instance: ACTIVE_INSTANCE,
    tenantId: 'tenant-arbitrario-iniettato-dal-client',
  });
  assert.equal(decision.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(decision, 'tenantId'), false);
});
