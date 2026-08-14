// ─── Test di isAppBillingBlocked (Audit pre-lancio 2026-08-14, BLOCKER #2) ──
// node:test built-in, nessuna dipendenza nuova, nessuna chiamata di
// rete/DB/Express reale — copre solo la soglia pura che decide se
// clientAuthMiddleware deve negare l'accesso alle API dati in base ad
// apps.status, stesso pattern di stripe-webhook-logic.test.js.
//
// La funzione non fa alcuna distinzione per app_type/auth_mode/product_id:
// la stessa identica soglia si applica a ogni app (comandi_ai, CreatorAI
// non-Catalog, Catalog Instance, app reseller legacy) perché apps.status è
// l'unica source of truth del lifecycle per tutte — non serve un caso di
// test per "tipo di app", solo per valore di status.
//
// Uso: node --test lib (dalla cartella backend/), o npm test.

const test = require('node:test');
const assert = require('node:assert/strict');

const { isAppBillingBlocked, BLOCKED_APP_STATUSES } = require('./client-auth');

test('active -> accesso consentito (non bloccato)', () => {
  assert.equal(isAppBillingBlocked({ status: 'active' }), false);
});

test('trial -> accesso consentito (non bloccato)', () => {
  assert.equal(isAppBillingBlocked({ status: 'trial' }), false);
});

test('canceled -> accesso negato (bloccato)', () => {
  assert.equal(isAppBillingBlocked({ status: 'canceled' }), true);
});

test('past_due -> accesso negato (bloccato, stessa soglia già applicata lato client in AppLayoutClient.tsx)', () => {
  assert.equal(isAppBillingBlocked({ status: 'past_due' }), true);
});

test('expired -> accesso negato (bloccato)', () => {
  assert.equal(isAppBillingBlocked({ status: 'expired' }), true);
});

test('status assente/null -> accesso consentito (default sicuro, nessuna app senza ciclo di fatturazione viene mai bloccata)', () => {
  assert.equal(isAppBillingBlocked({}), false);
  assert.equal(isAppBillingBlocked({ status: null }), false);
  assert.equal(isAppBillingBlocked(null), false);
});

test('valore di status sconosciuto/futuro -> accesso consentito (deny-list esplicita, non allow-list: mai un default che blocca per un valore non ancora previsto)', () => {
  assert.equal(isAppBillingBlocked({ status: 'some_future_status' }), false);
});

test('BLOCKED_APP_STATUSES contiene esattamente i 3 stati non in regola del CHECK constraint apps_status_check', () => {
  assert.deepEqual([...BLOCKED_APP_STATUSES].sort(), ['canceled', 'expired', 'past_due']);
});
