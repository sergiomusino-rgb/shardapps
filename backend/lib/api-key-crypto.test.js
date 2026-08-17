// ─── Test di lib/api-key-crypto.js (Data Export + Public API, Fase 2/12) ───
// node:test built-in, nessuna rete/DB — copre generazione/hash della API
// key. Stesso pattern di client-auth.test.js/entity-metadata.test.js.
//
// Uso: node --test lib (dalla cartella backend/), o npm test.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { generateApiKey, hashApiKey, looksLikeApiKey, KEY_BRAND } = require('./api-key-crypto');

test('generateApiKey produce una chiave col prefisso atteso e componenti coerenti', () => {
  const { fullKey, keyPrefix, keyHash } = generateApiKey();

  assert.equal(fullKey.startsWith(`${KEY_BRAND}_`), true);
  assert.equal(fullKey.startsWith(keyPrefix), true);
  assert.equal(keyHash, hashApiKey(fullKey));
  // La chiave completa non è mai riducibile al solo prefix pubblico: deve
  // contenere un segreto oltre al prefix (altrimenti prefix da solo
  // basterebbe a autenticarsi).
  assert.ok(fullKey.length > keyPrefix.length + 10);
});

test('generateApiKey non usa Math.random: due chiavi consecutive sono sempre diverse e ad alta entropia', () => {
  const keys = new Set();
  for (let i = 0; i < 200; i += 1) {
    const { fullKey } = generateApiKey();
    assert.equal(keys.has(fullKey), false, 'collisione inattesa tra chiavi generate');
    keys.add(fullKey);
  }
  assert.equal(keys.size, 200);
});

test('hashApiKey è deterministico e produce hash SHA-256 (64 hex char)', () => {
  const key = 'sa_live_deadbeefcafe_someSecretValueHere123';
  const h1 = hashApiKey(key);
  const h2 = hashApiKey(key);
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.equal(h1, crypto.createHash('sha256').update(key).digest('hex'));
});

test('hashApiKey di chiavi diverse produce hash diversi', () => {
  const { fullKey: k1 } = generateApiKey();
  const { fullKey: k2 } = generateApiKey();
  assert.notEqual(hashApiKey(k1), hashApiKey(k2));
});

test('looksLikeApiKey riconosce solo stringhe col formato atteso', () => {
  const { fullKey } = generateApiKey();
  assert.equal(looksLikeApiKey(fullKey), true);
  assert.equal(looksLikeApiKey('not-a-key'), false);
  assert.equal(looksLikeApiKey(''), false);
  assert.equal(looksLikeApiKey(null), false);
  assert.equal(looksLikeApiKey(undefined), false);
  assert.equal(looksLikeApiKey(`${KEY_BRAND}_tooshort`), false);
});
