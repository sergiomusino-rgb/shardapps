// ─── Test delle decisioni di autorizzazione (Fase 3, Priorità 2) ───────────
// node:test built-in, nessuna dipendenza nuova, nessuna chiamata di
// rete/DB/Express/Stripe — copre solo authorizeUpdateAppFee/authorizeSyncPlan
// (logica pura). Stesso pattern di backend/lib/stripe-webhook-logic.test.js.
//
// Uso: node --test lib (dalla cartella backend/), o npm test.

const test = require('node:test');
const assert = require('node:assert/strict');

const { authorizeUpdateAppFee, authorizeSyncPlan } = require('./stripe-route-authorization');

const VALID_USER = { id: 'user-123' };
const MEMBERSHIP = { tenant_id: 'tenant-1' };
const TENANT_BY_OWNER = { id: 'tenant-1' };

// ─── POST /api/update-app-fee ──────────────────────────────────────────────

test('update-app-fee 401: nessun utente autenticato -> "Non autorizzato"', () => {
  const decision = authorizeUpdateAppFee({ user: null, tenantId: 'tenant-1', action: 'increment', membership: null });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 401);
  assert.equal(decision.error, 'Non autorizzato');
});

test('update-app-fee 400: tenantId o action mancanti -> "tenantId e action obbligatori"', () => {
  assert.deepEqual(
    authorizeUpdateAppFee({ user: VALID_USER, tenantId: null, action: 'increment', membership: null }),
    { ok: false, status: 400, error: 'tenantId e action obbligatori' }
  );
  assert.deepEqual(
    authorizeUpdateAppFee({ user: VALID_USER, tenantId: 'tenant-1', action: null, membership: null }),
    { ok: false, status: 400, error: 'tenantId e action obbligatori' }
  );
});

test('update-app-fee 403: utente autenticato ma senza membership per QUESTO tenant -> "Non autorizzato"', () => {
  // Riproduce il tentativo cross-tenant: un utente Supabase valido (magari
  // membro di UN ALTRO tenant) che tenta di ricalcolare la fee di un tenant
  // a cui non appartiene.
  const decision = authorizeUpdateAppFee({ user: VALID_USER, tenantId: 'tenant-1', action: 'increment', membership: null });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 403);
  assert.equal(decision.error, 'Non autorizzato');
});

test('update-app-fee 200: utente autenticato + tenantId/action + membership -> ok', () => {
  const decision = authorizeUpdateAppFee({ user: VALID_USER, tenantId: 'tenant-1', action: 'increment', membership: MEMBERSHIP });
  assert.equal(decision.ok, true);
  assert.equal(decision.status, undefined);
});

// ─── POST /api/sync-plan ────────────────────────────────────────────────────

test('sync-plan 401: nessun utente autenticato -> "Non autorizzato"', () => {
  const decision = authorizeSyncPlan({ user: null, sessionId: 'cs_test_1', tenantId: 'tenant-1', membership: null, tenantByOwner: null });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 401);
  assert.equal(decision.error, 'Non autorizzato');
});

test('sync-plan 400: sessionId mancante -> "sessionId mancante"', () => {
  const decision = authorizeSyncPlan({ user: VALID_USER, sessionId: null, tenantId: null, membership: null, tenantByOwner: null });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 400);
  assert.equal(decision.error, 'sessionId mancante');
});

test('sync-plan 400: tenantId non risolvibile dalla sessione Stripe -> "tenant_id mancante nella sessione"', () => {
  const decision = authorizeSyncPlan({ user: VALID_USER, sessionId: 'cs_test_1', tenantId: null, membership: null, tenantByOwner: null });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 400);
  assert.equal(decision.error, 'tenant_id mancante nella sessione');
});

test('sync-plan 403: utente autenticato ma senza membership né proprietà del tenant -> "Tenant non autorizzato"', () => {
  // Tentativo cross-tenant: sessione Stripe reale ma di un tenant a cui
  // l'utente chiamante non appartiene in nessuno dei due modi.
  const decision = authorizeSyncPlan({ user: VALID_USER, sessionId: 'cs_test_1', tenantId: 'tenant-1', membership: null, tenantByOwner: null });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 403);
  assert.equal(decision.error, 'Tenant non autorizzato');
});

test('sync-plan 200: autorizzato via tenant_members -> ok', () => {
  const decision = authorizeSyncPlan({ user: VALID_USER, sessionId: 'cs_test_1', tenantId: 'tenant-1', membership: MEMBERSHIP, tenantByOwner: null });
  assert.equal(decision.ok, true);
});

test('sync-plan 200: autorizzato via fallback owner_id (nessuna riga tenant_members) -> ok', () => {
  // Il fallback esiste apposta per non rifiutare un pagamento legittimo
  // quando il tenant non ha ancora una riga tenant_members corrispondente.
  const decision = authorizeSyncPlan({ user: VALID_USER, sessionId: 'cs_test_1', tenantId: 'tenant-1', membership: null, tenantByOwner: TENANT_BY_OWNER });
  assert.equal(decision.ok, true);
});
