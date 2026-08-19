// ─── Test: password-hash (Pre-Beta Hardening, Blocco 6) ────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, looksHashed } from './password-hash.ts';

test('hashPassword: produce un hash bcrypt riconoscibile, mai la password in chiaro', async () => {
  const hash = await hashPassword('SuperSegreta123');
  assert.notEqual(hash, 'SuperSegreta123');
  assert.match(hash, /^\$2[aby]\$\d{2}\$/);
});

test('looksHashed: riconosce un hash bcrypt, rifiuta testo in chiaro', async () => {
  const hash = await hashPassword('x');
  assert.equal(looksHashed(hash), true);
  assert.equal(looksHashed('password123'), false);
  assert.equal(looksHashed(''), false);
});

test('verifyPassword: password corretta contro un hash reale -> match, nessun rehash necessario', async () => {
  const hash = await hashPassword('Password!1');
  const result = await verifyPassword('Password!1', hash);
  assert.equal(result.match, true);
  assert.equal(result.needsRehash, false);
});

test('verifyPassword: account legacy (valore in chiaro) con password corretta -> match E needsRehash', async () => {
  const result = await verifyPassword('vecchia-password', 'vecchia-password');
  assert.equal(result.match, true);
  assert.equal(result.needsRehash, true);
});

test('verifyPassword: account legacy con password errata -> nessun match, nessun rehash', async () => {
  const result = await verifyPassword('sbagliata', 'vecchia-password');
  assert.equal(result.match, false);
  assert.equal(result.needsRehash, false);
});

test('verifyPassword: valori mancanti -> mai un\'eccezione, nessun match', async () => {
  assert.deepEqual(await verifyPassword('x', null), { match: false, needsRehash: false });
  assert.deepEqual(await verifyPassword('x', undefined), { match: false, needsRehash: false });
});
