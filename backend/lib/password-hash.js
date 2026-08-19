'use strict';

// ─── Password hashing — Pre-Beta Hardening, Blocco 6 ───────────────────────
// Prima di questo modulo, ogni password cliente (apps.client_password/
// initial_password, app_credentials.client_password, app_rbac_users.
// client_password) era salvata e confrontata in CHIARO — dichiarato
// esplicitamente nel codice esistente (vedi commento storico in
// app_rbac_users, migration 20260812000000), mitigato solo da RLS deny-all +
// accesso service-role-only, non da hashing.
//
// bcryptjs (non `bcrypt`/`argon2` nativi): implementazione pura JS, stessa
// libreria usabile identica sia qui (Render/Express) sia lato frontend
// (Vercel serverless — dove un binding nativo rischierebbe di non compilare/
// non essere disponibile a runtime). Preferenza dichiarata nel task era
// argon2/bcrypt nativo; bcryptjs è la scelta più robusta compatibile con
// ENTRAMBI gli ambienti di deploy reali di questo repo, senza introdurre un
// build step nativo in nessuno dei due.
//
// Strategia di migrazione (nessuna riscrittura bulk del DB, mai un account
// esistente rotto): verifyPassword riconosce sia un hash bcrypt reale sia un
// valore ancora in chiaro (legacy). Un match riuscito su un valore in chiaro
// ritorna needsRehash:true — il chiamante (client-auth.js) riscrive subito
// l'hash al posto del testo in chiaro (rehash-on-verify): da quel login in
// poi l'account usa solo l'hash, nessuna migrazione forzata upfront.

const bcrypt = require('bcryptjs');

// Costo bilanciato per un login interattivo (non un batch): abbastanza alto
// da rendere un attacco a forza bruta offline costoso, abbastanza basso da
// non introdurre una latenza percepibile su un singolo login.
const BCRYPT_ROUNDS = 10;

const BCRYPT_HASH_RE = /^\$2[aby]\$\d{2}\$/;

function looksHashed(value) {
  return typeof value === 'string' && BCRYPT_HASH_RE.test(value);
}

async function hashPassword(plain) {
  return bcrypt.hash(String(plain), BCRYPT_ROUNDS);
}

/**
 * Verifica `plain` contro `stored`, che può essere un hash bcrypt reale
 * (account già migrato) o ancora testo in chiaro (account legacy). Ritorna
 * { match, needsRehash } — needsRehash è true SOLO quando il match riesce su
 * un valore in chiaro: il chiamante deve riscrivere l'hash subito dopo.
 * Mai un'eccezione: un valore memorizzato corrotto/non stringa risulta
 * semplicemente in nessun match, mai un crash del login.
 */
async function verifyPassword(plain, stored) {
  if (typeof stored !== 'string' || !stored || typeof plain !== 'string' || !plain) {
    return { match: false, needsRehash: false };
  }
  if (looksHashed(stored)) {
    try {
      const match = await bcrypt.compare(plain, stored);
      return { match, needsRehash: false };
    } catch {
      return { match: false, needsRehash: false };
    }
  }
  // Legacy in chiaro: confronto diretto, comportamento identico a prima
  // dell'introduzione dell'hashing.
  const match = stored === plain;
  return { match, needsRehash: match };
}

module.exports = { hashPassword, verifyPassword, looksHashed, BCRYPT_ROUNDS };
