// ─── Test della decisione di autorizzazione (Fase 5B) ──────────────────────
// node:test built-in, nessuna dipendenza nuova, nessuna chiamata di
// rete/DB/Next.js/Totalum — copre solo authorizeTotalumGenerationAccess
// (logica pura).
//
// Uso: node --test src/lib (dalla cartella frontend/), o npm test.

const test = require('node:test');
const assert = require('node:assert/strict');

const { authorizeTotalumGenerationAccess } = require('./totalum-generation-authorization');

const OWNER = { id: 'user-owner' };
const OTHER_USER = { id: 'user-other' };
const ROW_OWNED_BY_OWNER = { user_id: 'user-owner', tenant_id: 'tenant-1' };
const ROW_NULL_TENANT = { user_id: 'user-owner', tenant_id: null };

// ─── 401: nessuna autenticazione ───────────────────────────────────────────

test('401: nessun token -> "Autenticazione richiesta"', () => {
  const decision = authorizeTotalumGenerationAccess({
    token: null, user: null, ownershipRow: null, callerTenantId: null,
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 401);
  assert.equal(decision.error, 'Autenticazione richiesta');
});

test('401: token presente ma non valido (nessun utente risolto) -> "Token non valido"', () => {
  const decision = authorizeTotalumGenerationAccess({
    token: 'un-token-qualsiasi', user: null, ownershipRow: null, callerTenantId: null,
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 401);
  assert.equal(decision.error, 'Token non valido');
});

// ─── 404: projectId inesistente ────────────────────────────────────────────

test('404: nessuna riga totalum_generation_requests per questo projectId', () => {
  const decision = authorizeTotalumGenerationAccess({
    token: 'tok', user: OWNER, ownershipRow: null, callerTenantId: 'tenant-1',
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 404);
  assert.equal(decision.error, 'Progetto non trovato');
});

// ─── 200: utente autenticato con projectId proprio ─────────────────────────

test('200: stesso user_id del richiedente -> ok', () => {
  const decision = authorizeTotalumGenerationAccess({
    token: 'tok', user: OWNER, ownershipRow: ROW_OWNED_BY_OWNER, callerTenantId: null,
  });
  assert.equal(decision.ok, true);
});

test('200: user_id diverso ma stesso tenant_id del richiedente -> ok (membro dello stesso team)', () => {
  const decision = authorizeTotalumGenerationAccess({
    token: 'tok', user: OTHER_USER, ownershipRow: ROW_OWNED_BY_OWNER, callerTenantId: 'tenant-1',
  });
  assert.equal(decision.ok, true);
});

// ─── 403: progetto di un altro tenant/utente ───────────────────────────────

test('403: utente autenticato ma il projectId appartiene a un altro user_id/tenant_id -> "Non autorizzato"', () => {
  // Riproduce esattamente lo scenario del Finding: un utente autenticato
  // valido (magari owner di un ALTRO progetto/tenant) che tenta di leggere
  // lo status/schema di un progetto Totalum che non gli appartiene.
  const decision = authorizeTotalumGenerationAccess({
    token: 'tok', user: OTHER_USER, ownershipRow: ROW_OWNED_BY_OWNER, callerTenantId: 'tenant-2',
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 403);
  assert.equal(decision.error, 'Non autorizzato');
});

test('403: riga con tenant_id nullo (bypass admin) e richiedente diverso dal creatore -> "Non autorizzato"', () => {
  const decision = authorizeTotalumGenerationAccess({
    token: 'tok', user: OTHER_USER, ownershipRow: ROW_NULL_TENANT, callerTenantId: 'tenant-1',
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 403);
});

// ─── Ordine di priorità dei controlli ──────────────────────────────────────

test('priorita: senza token, ownership irrilevante -> resta 401 anche se ownershipRow è valorizzato', () => {
  const decision = authorizeTotalumGenerationAccess({
    token: null, user: OWNER, ownershipRow: ROW_OWNED_BY_OWNER, callerTenantId: 'tenant-1',
  });
  assert.equal(decision.status, 401);
  assert.equal(decision.error, 'Autenticazione richiesta');
});
