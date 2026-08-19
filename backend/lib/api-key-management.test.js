// ─── Test di lib/api-key-management.js (fix produzione 2026-08-17) ─────────
// node:test built-in + fake-supabase (stesso helper già usato da
// public-api-auth.test.js/event-router.test.js): nessuna rete/DB reale.
// Copre esattamente i 7 punti richiesti dal task di fix:
// 1. create API key   2. list API keys   3. revoke API key
// 4. (owner export: coperto a parte in data-export.js, non duplicato qui)
// 5. API key hash storage   6. secret non persistito   7. tenant isolation
//
// Uso: node --test lib (dalla cartella backend/), o npm test.

const test = require('node:test');
const { describe } = require('node:test');
const assert = require('node:assert/strict');

const { makeFakeSupabase } = require('./test-helpers/fake-supabase');
const { hashApiKey, looksLikeApiKey } = require('./api-key-crypto');
const { sanitizeScopes, toPublicKey, listApiKeys, createApiKey, revokeApiKey } = require('./api-key-management');

describe('sanitizeScopes', () => {
  test('scope singolo valido -> passa invariato', () => {
    assert.deepEqual(sanitizeScopes(['read']), ['read']);
  });
  test('read+write validi -> entrambi mantenuti', () => {
    assert.deepEqual(sanitizeScopes(['read', 'write']), ['read', 'write']);
  });
  test('scope sconosciuti filtrati via, duplicati rimossi', () => {
    assert.deepEqual(sanitizeScopes(['read', 'read', 'delete-everything']), ['read']);
  });
  test('array vuoto o non valido -> default read-only', () => {
    assert.deepEqual(sanitizeScopes([]), ['read']);
    assert.deepEqual(sanitizeScopes(null), ['read']);
    assert.deepEqual(sanitizeScopes(undefined), ['read']);
    assert.deepEqual(sanitizeScopes('read'), ['read']);
  });
  test('solo scope sconosciuti -> default read-only (mai un array vuoto)', () => {
    assert.deepEqual(sanitizeScopes(['admin', 'superuser']), ['read']);
  });
  test('webhook (Integrations Round 2) -> ammesso, ma isolato da read/write se richiesto da solo', () => {
    assert.deepEqual(sanitizeScopes(['webhook']), ['webhook']);
  });
  test('webhook + read insieme -> entrambi mantenuti (una chiave può avere più scope)', () => {
    assert.deepEqual(sanitizeScopes(['read', 'webhook']), ['read', 'webhook']);
  });
});

describe('toPublicKey — #5/#6 hash mai esposto, stato derivato correttamente', () => {
  const baseRow = {
    id: 'key-1', name: 'Test', key_prefix: 'sa_live_abc123',
    key_hash: 'sensitive-hash-value-should-never-appear-in-output',
    scopes: ['read'], created_at: '2026-01-01T00:00:00Z',
    last_used_at: null, expires_at: null, revoked_at: null,
  };

  test('non include mai key_hash nell\'oggetto pubblico', () => {
    const pub = toPublicKey(baseRow);
    assert.equal('key_hash' in pub, false);
    assert.equal(JSON.stringify(pub).includes('sensitive-hash-value'), false);
  });

  test('status "active" quando non revocata e non scaduta', () => {
    assert.equal(toPublicKey(baseRow).status, 'active');
  });

  test('status "revoked" quando revoked_at valorizzato, indipendentemente da expires_at', () => {
    const row = { ...baseRow, revoked_at: '2026-01-02T00:00:00Z' };
    assert.equal(toPublicKey(row).status, 'revoked');
  });

  test('status "expired" quando expires_at nel passato e non revocata', () => {
    const row = { ...baseRow, expires_at: '2020-01-01T00:00:00Z' };
    assert.equal(toPublicKey(row).status, 'expired');
  });

  test('status "active" quando expires_at nel futuro', () => {
    const row = { ...baseRow, expires_at: new Date(Date.now() + 86400000).toISOString() };
    assert.equal(toPublicKey(row).status, 'active');
  });
});

describe('createApiKey — #1/#5/#6 creazione, hash salvato, segreto mai persistito', () => {
  test('crea la riga con key_hash calcolato dal fullKey, mai il fullKey stesso', async () => {
    const supabase = makeFakeSupabase({ app_api_keys: [] });
    const result = await createApiKey(supabase, { appId: 'app-A', tenantId: 'tenant-A', name: 'My Key', scopes: ['read', 'write'] });

    assert.equal(result.ok, true);
    assert.equal(looksLikeApiKey(result.apiKey), true);
    assert.equal(result.apiKey.startsWith(`${result.key.keyPrefix}_`), true);

    const stored = supabase._tables.app_api_keys[0];
    // #6: il segreto completo non e' mai scritto nella riga salvata.
    assert.notEqual(stored.key_hash, result.apiKey);
    assert.equal(JSON.stringify(stored).includes(result.apiKey), false);
    // #5: l'hash salvato e' esattamente sha256(fullKey) — verificabile,
    // non un valore arbitrario.
    assert.equal(stored.key_hash, hashApiKey(result.apiKey));
  });

  test('name mancante -> 400, nessuna riga scritta', async () => {
    const supabase = makeFakeSupabase({ app_api_keys: [] });
    const result = await createApiKey(supabase, { appId: 'app-A', tenantId: 'tenant-A', name: '   ' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(supabase._tables.app_api_keys.length, 0);
  });

  test('expiresAt malformato -> 400', async () => {
    const supabase = makeFakeSupabase({ app_api_keys: [] });
    const result = await createApiKey(supabase, { appId: 'app-A', tenantId: 'tenant-A', name: 'X', expiresAt: 'non-una-data' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });

  test('scopes assenti -> default read-only, mai write per errore', async () => {
    const supabase = makeFakeSupabase({ app_api_keys: [] });
    const result = await createApiKey(supabase, { appId: 'app-A', tenantId: 'tenant-A', name: 'X' });
    assert.deepEqual(result.key.scopes, ['read']);
  });

  test('la riga viene salvata con app_id/tenant_id esattamente quelli passati, mai altri', async () => {
    const supabase = makeFakeSupabase({ app_api_keys: [] });
    await createApiKey(supabase, { appId: 'app-A', tenantId: 'tenant-A', name: 'X' });
    const stored = supabase._tables.app_api_keys[0];
    assert.equal(stored.app_id, 'app-A');
    assert.equal(stored.tenant_id, 'tenant-A');
  });
});

describe('listApiKeys — #2/#7 elenco e isolamento tenant/app', () => {
  function seedRow(overrides) {
    return {
      id: overrides.id, app_id: overrides.appId, tenant_id: overrides.tenantId,
      name: overrides.name || 'k', key_prefix: 'sa_live_x', key_hash: 'h',
      scopes: ['read'], created_at: '2026-01-01T00:00:00Z',
      last_used_at: null, expires_at: null, revoked_at: null,
    };
  }

  test('restituisce solo le chiavi della coppia app_id+tenant_id richiesta', async () => {
    const supabase = makeFakeSupabase({
      app_api_keys: [
        seedRow({ id: 'k1', appId: 'app-A', tenantId: 'tenant-A' }),
        seedRow({ id: 'k2', appId: 'app-B', tenantId: 'tenant-A' }), // stesso tenant, app diversa
        seedRow({ id: 'k3', appId: 'app-A', tenantId: 'tenant-B' }), // stessa app, tenant diverso (non dovrebbe accadere nella pratica, ma la query deve comunque escluderla)
      ],
    });
    const result = await listApiKeys(supabase, 'app-A', 'tenant-A');
    assert.equal(result.ok, true);
    assert.equal(result.keys.length, 1);
    assert.equal(result.keys[0].id, 'k1');
  });

  test('#7 isolamento cross-tenant: una app_id valida ma tenant_id sbagliato non restituisce nulla', async () => {
    const supabase = makeFakeSupabase({
      app_api_keys: [seedRow({ id: 'k1', appId: 'app-A', tenantId: 'tenant-A' })],
    });
    const result = await listApiKeys(supabase, 'app-A', 'tenant-OTHER');
    assert.equal(result.ok, true);
    assert.deepEqual(result.keys, []);
  });

  test('nessuna chiave -> array vuoto, non un errore', async () => {
    const supabase = makeFakeSupabase({ app_api_keys: [] });
    const result = await listApiKeys(supabase, 'app-A', 'tenant-A');
    assert.equal(result.ok, true);
    assert.deepEqual(result.keys, []);
  });
});

describe('revokeApiKey — #3/#7 revoca e isolamento', () => {
  function seedRow(overrides) {
    return {
      id: overrides.id, app_id: overrides.appId, tenant_id: overrides.tenantId,
      name: 'k', key_prefix: 'sa_live_x', key_hash: 'h', scopes: ['read'],
      created_at: '2026-01-01T00:00:00Z', last_used_at: null, expires_at: null, revoked_at: null,
    };
  }

  test('revoca una chiave esistente della propria app/tenant -> revoked_at valorizzato', async () => {
    const supabase = makeFakeSupabase({
      app_api_keys: [seedRow({ id: 'k1', appId: 'app-A', tenantId: 'tenant-A' })],
    });
    const result = await revokeApiKey(supabase, { appId: 'app-A', tenantId: 'tenant-A', keyId: 'k1' });
    assert.equal(result.ok, true);
    assert.equal(result.key.status, 'revoked');
    assert.notEqual(supabase._tables.app_api_keys[0].revoked_at, null);
  });

  test('#7 chiave esistente ma di un\'altra app -> 404, nessuna riga modificata', async () => {
    const supabase = makeFakeSupabase({
      app_api_keys: [seedRow({ id: 'k1', appId: 'app-B', tenantId: 'tenant-A' })],
    });
    const result = await revokeApiKey(supabase, { appId: 'app-A', tenantId: 'tenant-A', keyId: 'k1' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.equal(supabase._tables.app_api_keys[0].revoked_at, null);
  });

  test('#7 chiave esistente ma di un altro tenant -> 404, nessuna riga modificata', async () => {
    const supabase = makeFakeSupabase({
      app_api_keys: [seedRow({ id: 'k1', appId: 'app-A', tenantId: 'tenant-OTHER' })],
    });
    const result = await revokeApiKey(supabase, { appId: 'app-A', tenantId: 'tenant-A', keyId: 'k1' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
  });

  test('keyId inesistente -> 404', async () => {
    const supabase = makeFakeSupabase({ app_api_keys: [] });
    const result = await revokeApiKey(supabase, { appId: 'app-A', tenantId: 'tenant-A', keyId: 'ghost' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
  });
});
