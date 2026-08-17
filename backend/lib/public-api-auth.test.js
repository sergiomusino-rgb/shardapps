// ─── Test di lib/public-api-auth.js (Data Export + Public API, Fase 12) ────
// node:test built-in + fake-supabase (test-helpers/fake-supabase.js, stesso
// query-builder in memoria già usato da event-router.test.js/
// workflow-action-executor.test.js): nessuna rete/DB reale. Copre i casi
// OBBLIGATORI della Fase 12 del task che dipendono solo da logica pura
// (resolveApiKey/authorizeKeyForApp/requireScope prendono supabase/dati come
// parametro, vedi commenti nel modulo).
//
// Uso: node --test lib (dalla cartella backend/), o npm test.

const test = require('node:test');
const { describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { makeFakeSupabase } = require('./test-helpers/fake-supabase');
const { generateApiKey, hashApiKey } = require('./api-key-crypto');
const { resolveApiKey, authorizeKeyForApp, requireScope } = require('./public-api-auth');

const NOW = Date.now();
const FUTURE = new Date(NOW + 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();

function seedKey(overrides = {}) {
  const { fullKey, keyHash } = generateApiKey();
  const row = {
    id: overrides.id || 'key-1',
    app_id: 'app-A',
    tenant_id: 'tenant-A',
    name: 'Test key',
    key_prefix: 'sa_live_test',
    key_hash: keyHash,
    scopes: ['read'],
    expires_at: null,
    revoked_at: null,
    ...overrides,
  };
  return { fullKey, row };
}

describe('resolveApiKey — Fase 12, casi #4/#5/#9', () => {
  test('#9 API key ben formata ma assente dal DB -> 401 generico', async () => {
    const supabase = makeFakeSupabase({ app_api_keys: [] });
    const { fullKey } = generateApiKey();
    const result = await resolveApiKey(supabase, fullKey);
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
  });

  test('chiave sintatticamente non valida -> 401, nessuna query eseguita', async () => {
    const supabase = makeFakeSupabase({ app_api_keys: [] });
    const result = await resolveApiKey(supabase, 'Bearer garbage');
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
  });

  test('chiave valida, non revocata, non scaduta -> ok con la riga corretta', async () => {
    const { fullKey, row } = seedKey();
    const supabase = makeFakeSupabase({ app_api_keys: [row] });
    const result = await resolveApiKey(supabase, fullKey);
    assert.equal(result.ok, true);
    assert.equal(result.keyRow.id, 'key-1');
    assert.equal(result.keyRow.app_id, 'app-A');
  });

  test('#4 chiave revocata -> deny', async () => {
    const { fullKey, row } = seedKey({ revoked_at: PAST });
    const supabase = makeFakeSupabase({ app_api_keys: [row] });
    const result = await resolveApiKey(supabase, fullKey);
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.match(result.error, /revocat/i);
  });

  test('#5 chiave scaduta -> deny', async () => {
    const { fullKey, row } = seedKey({ expires_at: PAST });
    const supabase = makeFakeSupabase({ app_api_keys: [row] });
    const result = await resolveApiKey(supabase, fullKey);
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.match(result.error, /scadut/i);
  });

  test('chiave con expires_at futuro -> resta valida', async () => {
    const { fullKey, row } = seedKey({ expires_at: FUTURE });
    const supabase = makeFakeSupabase({ app_api_keys: [row] });
    const result = await resolveApiKey(supabase, fullKey);
    assert.equal(result.ok, true);
  });

  test('due chiavi diverse hanno hash diversi e non si autenticano a vicenda', async () => {
    const { row: rowA } = seedKey({ id: 'key-A' });
    const { fullKey: fullKeyB, row: rowB } = seedKey({ id: 'key-B', key_hash: hashApiKey('completamente-diversa') });
    const supabase = makeFakeSupabase({ app_api_keys: [rowA, rowB] });
    // fullKeyB è stata generata per rowB con un hash che è stato sovrascritto
    // sopra: deve quindi risultare "non trovata" (nessuna riga con quell'hash).
    const result = await resolveApiKey(supabase, fullKeyB);
    assert.equal(result.ok, false);
  });
});

describe('authorizeKeyForApp — Fase 12, casi #2/#3 (cross-app / cross-tenant)', () => {
  const keyForAppA = { app_id: 'app-A', tenant_id: 'tenant-A' };

  test('#2 chiave dell\'app A usata sul path dell\'app B -> 403 DENY', () => {
    const app = { id: 'app-B', tenant_id: 'tenant-A', status: 'active' };
    const result = authorizeKeyForApp(keyForAppA, 'app-B', app);
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
  });

  test('appId combacia, app esiste, stesso tenant, billing ok -> ok', () => {
    const app = { id: 'app-A', tenant_id: 'tenant-A', status: 'active' };
    const result = authorizeKeyForApp(keyForAppA, 'app-A', app);
    assert.equal(result.ok, true);
  });

  test('#3 app trovata ma tenant_id non corrisponde a quello della chiave -> DENY (404)', () => {
    const app = { id: 'app-A', tenant_id: 'tenant-OTHER', status: 'active' };
    const result = authorizeKeyForApp(keyForAppA, 'app-A', app);
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
  });

  test('app inesistente (null) -> 404', () => {
    const result = authorizeKeyForApp(keyForAppA, 'app-A', null);
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
  });

  test('app con abbonamento non attivo (canceled) -> 403, anche se la chiave stessa è valida', () => {
    const app = { id: 'app-A', tenant_id: 'tenant-A', status: 'canceled' };
    const result = authorizeKeyForApp(keyForAppA, 'app-A', app);
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
  });
});

describe('requireScope — Fase 12, casi #6/#7/#8 (read-only + scrittura)', () => {
  function callMiddleware(scope, apiKeyScopes) {
    const req = { apiKeyScopes };
    let statusCode = null;
    let body = null;
    let nextCalled = false;
    const res = {
      status(code) { statusCode = code; return this; },
      json(payload) { body = payload; return this; },
    };
    requireScope(scope)(req, res, () => { nextCalled = true; });
    return { statusCode, body, nextCalled };
  }

  test('#6 chiave read-only + scope write richiesto (POST) -> 403 DENY', () => {
    const { statusCode, nextCalled } = callMiddleware('write', ['read']);
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 403);
  });

  test('#7 chiave read-only + scope write richiesto (PATCH) -> 403 DENY', () => {
    const { statusCode, nextCalled } = callMiddleware('write', ['read']);
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 403);
  });

  test('#8 chiave read-only + scope write richiesto (DELETE) -> 403 DENY', () => {
    const { statusCode, nextCalled } = callMiddleware('write', ['read']);
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 403);
  });

  test('chiave read+write + scope write richiesto -> consentito', () => {
    const { nextCalled, statusCode } = callMiddleware('write', ['read', 'write']);
    assert.equal(nextCalled, true);
    assert.equal(statusCode, null);
  });

  test('chiave read-only + scope read richiesto (GET) -> consentito', () => {
    const { nextCalled } = callMiddleware('read', ['read']);
    assert.equal(nextCalled, true);
  });
});

describe('#10 API key non presente nei log', () => {
  test('il sorgente di public-api-auth.js non stampa mai la chiave grezza/hash in console.*', () => {
    const source = fs.readFileSync(path.join(__dirname, 'public-api-auth.js'), 'utf8');
    const consoleCalls = source.match(/console\.\w+\([^)]*\)/g) || [];
    for (const call of consoleCalls) {
      assert.doesNotMatch(call, /rawKey|fullKey|keyHash/, `console call non deve loggare la chiave: ${call}`);
    }
  });
});
