// ─── Data Export + Public API — generazione/hash API key ───────────────────
// Stesso principio già in uso per i token di reset password
// (frontend/app/api/a/[slug]/reset-password/route.ts, tabella
// app_password_reset_tokens): la chiave completa non è mai salvata, solo il
// suo hash SHA-256 — se il DB trapela, le chiavi già emesse restano
// inutilizzabili. Generazione con crypto.randomBytes (mai Math.random, vedi
// il commento già presente in routes/generate.js sullo stesso principio).
//
// Formato chiave: "sa_live_<prefix12hex>_<secret43base64url>"
// - "sa_live" identifica ShardApps in chiaro (utile per secret-scanning
//   automatico lato utente/GitHub, stesso spirito dei prefissi Stripe/GitHub).
// - prefix12hex (6 byte) è pubblico: salvato in chiaro come key_prefix e
//   mostrato nell'elenco chiavi della dashboard per permettere all'utente di
//   riconoscere quale chiave sta guardando, senza mai poter ricostruire il
//   segreto.
// - secret (32 byte, 256 bit di entropia) è la parte segreta: MAI salvata,
//   solo il suo hash (in realtà si fa l'hash dell'intera chiave, non del solo
//   secret, per semplicità — irrilevante ai fini della sicurezza dato che il
//   prefix è comunque pubblico).

const crypto = require('crypto');

const KEY_BRAND = 'sa_live';

function generateApiKey() {
  const prefixPart = crypto.randomBytes(6).toString('hex'); // 12 caratteri hex
  const secretPart = crypto.randomBytes(32).toString('base64url'); // ~43 caratteri, 256 bit
  const keyPrefix = `${KEY_BRAND}_${prefixPart}`;
  const fullKey = `${keyPrefix}_${secretPart}`;
  const keyHash = hashApiKey(fullKey);
  return { fullKey, keyPrefix, keyHash };
}

function hashApiKey(rawKey) {
  return crypto.createHash('sha256').update(String(rawKey)).digest('hex');
}

// Riconosce rapidamente una stringa come "sembra una nostra API key" prima
// di sprecare una query DB — non è una verifica di validità, solo forma.
function looksLikeApiKey(value) {
  return typeof value === 'string' && value.startsWith(`${KEY_BRAND}_`) && value.length >= 40;
}

module.exports = { generateApiKey, hashApiKey, looksLikeApiKey, KEY_BRAND };
