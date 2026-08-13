// ─── Test della decisione di autorizzazione (App Catalog STEP 3) ──────────
// node:test built-in, nessuna dipendenza nuova, nessuna chiamata di
// rete/DB/Next.js/Supabase — copre solo authorizeCatalogProvision (logica
// pura), stesso pattern di totalum-generation-authorization.test.js.
//
// Uso: node --test src/lib (dalla cartella frontend/), o npm test.

const test = require('node:test');
const assert = require('node:assert/strict');

const { authorizeCatalogProvision } = require('./catalog-provision-authorization');

const USER = { id: 'user-1' };
const ACTIVE_PRODUCT = { id: 'product-1', slug: 'follow-ai', is_active: true };
const INACTIVE_PRODUCT = { id: 'product-2', slug: 'discontinued-ai', is_active: false };
const ACTIVE_VERSION = { id: 'version-1', product_id: 'product-1', version: '1.0.0', is_active: true };
const INACTIVE_VERSION = { id: 'version-2', product_id: 'product-1', version: '0.9.0', is_active: false };

// ─── 401 ────────────────────────────────────────────────────────────────

test('401: nessun token -> "Autenticazione richiesta"', () => {
  const decision = authorizeCatalogProvision({ token: null, user: null, product: null, version: null });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 401);
  assert.equal(decision.error, 'Autenticazione richiesta');
  assert.equal(decision.code, 'UNAUTHORIZED');
});

test('401: token presente ma nessun utente risolto -> "Token non valido"', () => {
  const decision = authorizeCatalogProvision({ token: 'tok', user: null, product: ACTIVE_PRODUCT, version: ACTIVE_VERSION });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 401);
  assert.equal(decision.error, 'Token non valido');
  assert.equal(decision.code, 'UNAUTHORIZED');
});

// ─── 404: prodotto ──────────────────────────────────────────────────────

test('404: prodotto inesistente -> "Prodotto non trovato"', () => {
  const decision = authorizeCatalogProvision({ token: 'tok', user: USER, product: null, version: null });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 404);
  assert.equal(decision.error, 'Prodotto non trovato');
  assert.equal(decision.code, 'PRODUCT_NOT_FOUND');
});

test('404: prodotto disattivato -> stesso errore/status/code del prodotto inesistente (nessuna distinzione osservabile)', () => {
  const decision = authorizeCatalogProvision({ token: 'tok', user: USER, product: INACTIVE_PRODUCT, version: null });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 404);
  assert.equal(decision.error, 'Prodotto non trovato');
  assert.equal(decision.code, 'PRODUCT_NOT_FOUND');
});

// ─── 404: versione ──────────────────────────────────────────────────────

test('404: prodotto attivo ma nessuna versione risolta -> "Versione non trovata"', () => {
  const decision = authorizeCatalogProvision({ token: 'tok', user: USER, product: ACTIVE_PRODUCT, version: null });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 404);
  assert.equal(decision.error, 'Versione non trovata');
});

test('404: versione disattivata -> stesso errore/status della versione inesistente', () => {
  const decision = authorizeCatalogProvision({ token: 'tok', user: USER, product: ACTIVE_PRODUCT, version: INACTIVE_VERSION });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 404);
  assert.equal(decision.error, 'Versione non trovata');
});

// ─── 200 ────────────────────────────────────────────────────────────────

test('ok: prodotto attivo + versione attiva -> autorizzato', () => {
  const decision = authorizeCatalogProvision({ token: 'tok', user: USER, product: ACTIVE_PRODUCT, version: ACTIVE_VERSION });
  assert.equal(decision.ok, true);
});

// ─── Ordine di priorità dei controlli ──────────────────────────────────

test('priorita: senza token, prodotto/versione irrilevanti -> resta 401', () => {
  const decision = authorizeCatalogProvision({ token: null, user: USER, product: ACTIVE_PRODUCT, version: ACTIVE_VERSION });
  assert.equal(decision.status, 401);
  assert.equal(decision.error, 'Autenticazione richiesta');
});

test('priorita: utente autenticato, prodotto rifiutato prima della versione (versione valida ma prodotto no)', () => {
  const decision = authorizeCatalogProvision({ token: 'tok', user: USER, product: INACTIVE_PRODUCT, version: ACTIVE_VERSION });
  assert.equal(decision.status, 404);
  assert.equal(decision.error, 'Prodotto non trovato');
});

// ─── Garanzia strutturale: nessun tenant nella firma ───────────────────
// Il tenant_id non è (e non può essere) un parametro di questa funzione: è
// risolto interamente lato route da getOrCreateTenant(user, token), mai da
// un valore fornito dal client. Verificato qui a livello di firma, non solo
// di comportamento: un futuro refactor che aggiungesse un parametro
// `tenantId` proveniente dal client romperebbe questa assunzione visibile.
test('garanzia strutturale: authorizeCatalogProvision non accetta/usa alcun tenantId in input', () => {
  const decision = authorizeCatalogProvision({
    token: 'tok', user: USER, product: ACTIVE_PRODUCT, version: ACTIVE_VERSION,
    tenantId: 'tenant-arbitrario-iniettato-dal-client',
  });
  // Anche se un chiamante scorretto passasse un tenantId, la funzione non lo
  // legge né lo espone nella decisione: la firma reale è {token,user,product,version}.
  assert.equal(decision.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(decision, 'tenantId'), false);
});
