// ─── Test della decisione di autorizzazione (Fase 3, Step 1.3) ─────────────
// node:test built-in, nessuna dipendenza nuova, nessuna chiamata di
// rete/DB/Next.js — copre solo authorizeCancelSubscription (logica pura).
//
// Uso: node --test src/lib (dalla cartella frontend/), o npm test.

const test = require('node:test');
const assert = require('node:assert/strict');

const { authorizeCancelSubscription } = require('./cancel-subscription-authorization');

const VALID_USER = { id: 'user-123' };
const APP_WITH_SUB = { id: 'app-1', stripe_subscription_id: 'sub_test_1' };
const APP_WITHOUT_SUB = { id: 'app-1', stripe_subscription_id: null };
const VALID_APP_USER = { id: 'app_users-row-1' };

// ─── Scenario 1: 401 Unauthorized ──────────────────────────────────────────

test('401: nessun token -> "Autenticazione richiesta"', () => {
  const decision = authorizeCancelSubscription({ token: null, user: null, app: null, appUser: null });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 401);
  assert.equal(decision.error, 'Autenticazione richiesta');
});

test('401: token presente ma non valido (nessun utente risolto) -> "Token non valido"', () => {
  // Simula auth.getUser(token) che non risolve un utente (token scaduto/malformato).
  const decision = authorizeCancelSubscription({ token: 'un-token-qualsiasi', user: null, app: null, appUser: null });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 401);
  assert.equal(decision.error, 'Token non valido');
});

// ─── App inesistente (404, non tra i 3 scenari richiesti ma nella catena) ──

test('404: app non trovata per lo slug', () => {
  const decision = authorizeCancelSubscription({ token: 'tok', user: VALID_USER, app: null, appUser: null });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 404);
  assert.equal(decision.error, 'App non trovata');
});

// ─── Scenario 2: 403 Forbidden (cross-tenant, caso 15) ─────────────────────

test('403: utente autenticato ma senza riga app_users per QUESTA app -> "Non autorizzato"', () => {
  // Riproduce esattamente la vulnerabilità originale: un utente Supabase
  // valido (magari admin di UN'ALTRA app, o senza alcuna app) che tenta di
  // cancellare l'abbonamento di un'app che non gli appartiene.
  const decision = authorizeCancelSubscription({ token: 'tok', user: VALID_USER, app: APP_WITH_SUB, appUser: null });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 403);
  assert.equal(decision.error, 'Non autorizzato');
});

// ─── Scenario 3: 200 OK ─────────────────────────────────────────────────────

test('200: token valido + utente + app_users(admin) per questa app + subscription attiva -> ok', () => {
  const decision = authorizeCancelSubscription({
    token: 'tok',
    user: VALID_USER,
    app: APP_WITH_SUB,
    appUser: VALID_APP_USER,
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.status, undefined);
  assert.equal(decision.error, undefined);
});

// ─── Caso limite: ownership corretta ma nessun abbonamento da cancellare ───

test('400: ownership corretta ma app.stripe_subscription_id assente -> "Nessun abbonamento attivo"', () => {
  const decision = authorizeCancelSubscription({
    token: 'tok',
    user: VALID_USER,
    app: APP_WITHOUT_SUB,
    appUser: VALID_APP_USER,
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 400);
  assert.equal(decision.error, 'Nessun abbonamento attivo');
});

// ─── Ordine di priorità dei controlli ──────────────────────────────────────

test('priorita: senza token, ownership/app irrilevanti -> resta 401 "Autenticazione richiesta" anche se appUser è valorizzato', () => {
  // Non dovrebbe succedere nella route reale (appUser non viene mai
  // interrogato senza prima un utente autenticato), ma la funzione pura
  // deve restare corretta anche se chiamata con input incoerenti: il
  // controllo sul token ha sempre priorità.
  const decision = authorizeCancelSubscription({ token: null, user: VALID_USER, app: APP_WITH_SUB, appUser: VALID_APP_USER });
  assert.equal(decision.status, 401);
  assert.equal(decision.error, 'Autenticazione richiesta');
});
