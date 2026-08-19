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

const { isAppBillingBlocked, BLOCKED_APP_STATUSES, verifyLegacyPassword, resolveClientIdentity } = require('./client-auth');
const { hashPassword } = require('./password-hash');
const { makeFakeSupabase } = require('./test-helpers/fake-supabase');

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

// ─── Pre-Beta Hardening, Blocco 6 — verifyLegacyPassword/resolveClientIdentity
// con hashing password ───────────────────────────────────────────────────

test('verifyLegacyPassword: account già migrato (hash reale) con password corretta -> true, nessuna riscrittura', async () => {
  const hash = await hashPassword('SegretaVera1');
  const supabase = makeFakeSupabase({ app_credentials: [{ app_id: 'app-1', client_password: hash }] });
  const app = { id: 'app-1' };
  const ok = await verifyLegacyPassword(supabase, app, 'SegretaVera1');
  assert.equal(ok, true);
  const { data } = await supabase.from('app_credentials').select().eq('app_id', 'app-1');
  assert.equal(data[0].client_password, hash, 'un account già hashato non viene mai riscritto inutilmente');
});

test('verifyLegacyPassword: account legacy (chiaro) con password corretta -> true E riscrive subito l\'hash (rehash-on-verify)', async () => {
  const supabase = makeFakeSupabase({ app_credentials: [{ app_id: 'app-1', client_password: 'vecchia-chiaro' }] });
  const app = { id: 'app-1' };
  const ok = await verifyLegacyPassword(supabase, app, 'vecchia-chiaro');
  assert.equal(ok, true);
  const { data } = await supabase.from('app_credentials').select().eq('app_id', 'app-1');
  assert.notEqual(data[0].client_password, 'vecchia-chiaro', 'la password in chiaro non deve più esistere in tabella dopo il login');
  assert.match(data[0].client_password, /^\$2[aby]\$/);
});

test('verifyLegacyPassword: account legacy con password errata -> false, nessuna riscrittura (non era il match)', async () => {
  const supabase = makeFakeSupabase({ app_credentials: [{ app_id: 'app-1', client_password: 'vecchia-chiaro' }] });
  const app = { id: 'app-1' };
  const ok = await verifyLegacyPassword(supabase, app, 'sbagliata');
  assert.equal(ok, false);
  const { data } = await supabase.from('app_credentials').select().eq('app_id', 'app-1');
  assert.equal(data[0].client_password, 'vecchia-chiaro');
});

test('verifyLegacyPassword: fallback su apps.client_password quando non esiste ancora una riga app_credentials', async () => {
  const supabase = makeFakeSupabase({});
  const app = { id: 'app-legacy', client_password: 'password-vecchio-schema' };
  const ok = await verifyLegacyPassword(supabase, app, 'password-vecchio-schema');
  assert.equal(ok, true);
});

test('resolveClientIdentity (rbac): credenziali già hashate, password corretta -> ok, ruolo/email propagati', async () => {
  const hash = await hashPassword('OperatorPass1');
  const supabase = makeFakeSupabase({
    app_rbac_users: [{ id: 'u1', app_id: 'app-1', tenant_id: 'tenant-1', client_email: 'op@example.com', client_password: hash, role: 'operator' }],
  });
  const app = { id: 'app-1', tenant_id: 'tenant-1', auth_mode: 'rbac' };
  const result = await resolveClientIdentity(supabase, app, 'app-1', 'op@example.com:OperatorPass1');
  assert.equal(result.ok, true);
  assert.equal(result.appUserRole, 'operator');
  assert.equal(result.appUserEmail, 'op@example.com');
});

test('resolveClientIdentity (rbac): credenziali legacy in chiaro, password corretta -> ok E rehash immediato', async () => {
  const supabase = makeFakeSupabase({
    app_rbac_users: [{ id: 'u1', app_id: 'app-1', tenant_id: 'tenant-1', client_email: 'op@example.com', client_password: 'chiaro123', role: 'admin' }],
  });
  const app = { id: 'app-1', tenant_id: 'tenant-1', auth_mode: 'rbac' };
  const result = await resolveClientIdentity(supabase, app, 'app-1', 'op@example.com:chiaro123');
  assert.equal(result.ok, true);

  const { data } = await supabase.from('app_rbac_users').select().eq('app_id', 'app-1').eq('client_email', 'op@example.com');
  assert.notEqual(data[0].client_password, 'chiaro123');
  assert.match(data[0].client_password, /^\$2[aby]\$/);
});

test('resolveClientIdentity (rbac): password errata contro credenziali hashate -> 401, nessuna riscrittura', async () => {
  const hash = await hashPassword('CorrettaPass');
  const supabase = makeFakeSupabase({
    app_rbac_users: [{ id: 'u1', app_id: 'app-1', tenant_id: 'tenant-1', client_email: 'op@example.com', client_password: hash, role: 'viewer' }],
  });
  const app = { id: 'app-1', tenant_id: 'tenant-1', auth_mode: 'rbac' };
  const result = await resolveClientIdentity(supabase, app, 'app-1', 'op@example.com:sbagliata');
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test('isolamento: il rehash di un account rbac non tocca le credenziali di un altro utente/app', async () => {
  const supabase = makeFakeSupabase({
    app_rbac_users: [
      { id: 'u1', app_id: 'app-1', tenant_id: 'tenant-1', client_email: 'a@example.com', client_password: 'chiaroA', role: 'admin' },
      { id: 'u2', app_id: 'app-1', tenant_id: 'tenant-1', client_email: 'b@example.com', client_password: 'chiaroB', role: 'operator' },
    ],
  });
  const app = { id: 'app-1', tenant_id: 'tenant-1', auth_mode: 'rbac' };
  await resolveClientIdentity(supabase, app, 'app-1', 'a@example.com:chiaroA');

  const { data } = await supabase.from('app_rbac_users').select().eq('app_id', 'app-1').eq('client_email', 'b@example.com');
  assert.equal(data[0].client_password, 'chiaroB', 'la password di b@example.com resta invariata (in chiaro, non ancora effettuato login)');
});
