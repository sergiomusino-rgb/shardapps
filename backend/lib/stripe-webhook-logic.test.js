// ─── Test della logica pura di billing (Fase 3, Step 4) ────────────────────
// Stesso pattern di backend/scripts/check_rls_policies.test.js (Fase 2):
// node:test built-in, zero dipendenze nuove, nessuna chiamata di rete/DB —
// copre solo backend/lib/stripe-webhook-logic.js.
//
// Uso: node --test lib (dalla cartella backend/), o npm test.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PLAN_RANK,
  planRank,
  APP_SUBSCRIPTION_STATUS_MAP,
  resolveAppStatusFromStripeStatus,
  isStaleEvent,
  isDuplicateSessionError,
} = require('./stripe-webhook-logic');

// ─── 1. planRank() e guardia anti-downgrade ─────────────────────────────────

test('planRank: rango crescente starter < pro < business', () => {
  assert.ok(planRank('starter') < planRank('pro'));
  assert.ok(planRank('pro') < planRank('business'));
});

test('planRank: basic ha lo stesso rango di starter (alias storico)', () => {
  assert.equal(planRank('basic'), planRank('starter'));
});

test('planRank: vip ha lo stesso rango di business (alias storico)', () => {
  assert.equal(planRank('vip'), planRank('business'));
});

test('planRank: piano sconosciuto o mancante -> 0 (fallback difensivo)', () => {
  assert.equal(planRank('piano-inventato'), 0);
  assert.equal(planRank(undefined), 0);
  assert.equal(planRank(null), 0);
});

test('planRank: guardia anti-downgrade — un piano pari o superiore passa, uno inferiore no', () => {
  // Stessa espressione usata nei call site reali (applyCheckoutSessionOnce,
  // /sync-plan, webhook frontend): planRank(nuovo) >= planRank(attuale).
  const currentPlan = 'business';
  assert.equal(planRank('business') >= planRank(currentPlan), true); // stesso piano: applicato
  assert.equal(planRank('starter') >= planRank(currentPlan), false); // downgrade: bloccato
  assert.equal(planRank('vip') >= planRank(currentPlan), true); // pari rango (alias): applicato
});

// ─── 2. Routing/parsing eventi webhook: mappatura stati ────────────────────

test('resolveAppStatusFromStripeStatus: active e trialing -> active', () => {
  assert.equal(resolveAppStatusFromStripeStatus('active'), 'active');
  assert.equal(resolveAppStatusFromStripeStatus('trialing'), 'active');
});

test('resolveAppStatusFromStripeStatus: past_due, unpaid, incomplete -> past_due', () => {
  assert.equal(resolveAppStatusFromStripeStatus('past_due'), 'past_due');
  assert.equal(resolveAppStatusFromStripeStatus('unpaid'), 'past_due');
  assert.equal(resolveAppStatusFromStripeStatus('incomplete'), 'past_due');
});

test('resolveAppStatusFromStripeStatus: canceled e incomplete_expired -> canceled', () => {
  assert.equal(resolveAppStatusFromStripeStatus('canceled'), 'canceled');
  assert.equal(resolveAppStatusFromStripeStatus('incomplete_expired'), 'canceled');
});

test('resolveAppStatusFromStripeStatus: status Stripe non mappato -> null (l\'handler chiamante deve ignorare, non scrivere)', () => {
  assert.equal(resolveAppStatusFromStripeStatus('paused'), null);
  assert.equal(resolveAppStatusFromStripeStatus(undefined), null);
});

test('APP_SUBSCRIPTION_STATUS_MAP: copre esattamente gli stessi 7 stati Stripe di frontend/.../webhooks/stripe/route.ts::handleAppSubscriptionUpdated', () => {
  assert.deepEqual(Object.keys(APP_SUBSCRIPTION_STATUS_MAP).sort(), [
    'active', 'canceled', 'incomplete', 'incomplete_expired', 'past_due', 'trialing', 'unpaid',
  ]);
});

// ─── 3. Idempotenza: errore Postgres 23505 (webhook duplicato/retry) ───────

test('isDuplicateSessionError: codice 23505 (violazione UNIQUE) -> true', () => {
  assert.equal(isDuplicateSessionError({ code: '23505' }), true);
});

test('isDuplicateSessionError: qualunque altro codice/errore -> false (deve propagare)', () => {
  assert.equal(isDuplicateSessionError({ code: '23503' }), false); // foreign key violation, diverso
  assert.equal(isDuplicateSessionError({ code: '42501' }), false); // permission denied
  assert.equal(isDuplicateSessionError(new Error('errore generico senza code')), false);
});

test('isDuplicateSessionError: nessun errore -> false (non c\'era nulla da ignorare)', () => {
  assert.equal(isDuplicateSessionError(null), false);
  assert.equal(isDuplicateSessionError(undefined), false);
});

test('isDuplicateSessionError: simula il flusso reale — insert fallito con 23505 viene trattato come no-op, non da rilanciare', () => {
  // Stessa forma di applyCheckoutSessionOnce/sync-plan: insertError da un
  // secondo tentativo di scrivere la stessa riga in processed_checkout_sessions
  // (webhook e /sync-plan che processano la stessa sessione quasi in parallelo).
  const insertError = { code: '23505', message: 'duplicate key value violates unique constraint' };
  const shouldSkipAsNoOp = isDuplicateSessionError(insertError);
  const shouldRethrow = insertError && !isDuplicateSessionError(insertError);
  assert.equal(shouldSkipAsNoOp, true);
  assert.equal(shouldRethrow, false);
});

// ─── 4. Prevenzione eventi fuori ordine (caso 13) ──────────────────────────

test('isStaleEvent: evento più vecchio dell\'ultimo aggiornamento registrato -> true (va scartato)', () => {
  const rowUpdatedAt = new Date().toISOString();
  const eventCreatedAt = Math.floor(Date.now() / 1000) - 3600; // 1 ora prima
  assert.equal(isStaleEvent(eventCreatedAt, rowUpdatedAt), true);
});

test('isStaleEvent: evento più recente dell\'ultimo aggiornamento -> false (va applicato)', () => {
  const rowUpdatedAt = new Date(Date.now() - 3600 * 1000).toISOString(); // 1 ora fa
  const eventCreatedAt = Math.floor(Date.now() / 1000); // ora
  assert.equal(isStaleEvent(eventCreatedAt, rowUpdatedAt), false);
});

test('isStaleEvent: nessuna riga precedente (rowUpdatedAt assente) -> false (niente con cui confrontare, non può essere fuori ordine)', () => {
  assert.equal(isStaleEvent(Math.floor(Date.now() / 1000), null), false);
  assert.equal(isStaleEvent(Math.floor(Date.now() / 1000), undefined), false);
});

test('isStaleEvent: timestamp malformato -> false (difensivo, non blocca l\'evento)', () => {
  assert.equal(isStaleEvent(Math.floor(Date.now() / 1000), 'non-una-data'), false);
});

test('isStaleEvent: accetta sia secondi Unix (number) sia Date come eventCreatedAt', () => {
  const rowUpdatedAt = new Date().toISOString();
  const oneHourAgoSeconds = Math.floor(Date.now() / 1000) - 3600;
  const oneHourAgoDate = new Date(Date.now() - 3600 * 1000);
  assert.equal(isStaleEvent(oneHourAgoSeconds, rowUpdatedAt), true);
  assert.equal(isStaleEvent(oneHourAgoDate, rowUpdatedAt), true);
});

test('isStaleEvent: scenario reale caso 13 — un customer.subscription.deleted in ritardo dopo un rinnovo già applicato viene scartato', () => {
  // T=100: rinnovo (invoice.payment_succeeded) applicato, scrive updated_at=T100.
  const renewalAppliedAt = new Date(1700000100 * 1000).toISOString();
  // T=90: evento di cancellazione, cronologicamente precedente al rinnovo,
  // ma consegnato in ritardo (arriva DOPO che il rinnovo è già stato scritto).
  const staleDeletedEventCreated = 1700000090;
  assert.equal(isStaleEvent(staleDeletedEventCreated, renewalAppliedAt), true);
});
