// ─── Decisione pura di autorizzazione — POST /api/catalog/products/         ──
// ─── [productSlug]/provision (App Catalog & Instance Model, STEP 3) ───────
// Stesso pattern di totalum-generation-authorization.js/cancel-subscription-
// authorization.js: nessun I/O qui, la route esegue le query (Supabase
// auth.getUser, SELECT app_products, SELECT app_product_versions) e passa
// solo i risultati già risolti; questa funzione decide soltanto se
// procedere e con quale status/errore altrimenti.
//
// Sicurezza (FASE 6 dell'audit App Catalog):
// - prodotto non trovato E prodotto disattivato restituiscono lo STESSO
//   errore/status (404 "Prodotto non trovato"): un chiamante che enumera
//   slug non deve poter distinguere "non esiste" da "esiste ma è
//   disattivato" — stesso principio già usato per l'endpoint pubblico
//   records (frontend/app/api/public/apps/[slug]/records/route.ts).
// - stessa scelta per la versione (404 "Versione non trovata" sia per
//   versione inesistente sia per versione disattivata).
// - questa funzione non vede né decide MAI il tenant_id: quello è risolto
//   interamente lato route da getOrCreateTenant(supabase, user, token) —
//   nessun valore fornito dal client entra mai in questa decisione, per
//   costruzione (la firma della funzione non accetta un tenantId in input).
function authorizeCatalogProvision({ token, user, product, version }) {
  if (!token) {
    return { ok: false, status: 401, error: 'Autenticazione richiesta', code: 'UNAUTHORIZED' };
  }
  if (!user) {
    return { ok: false, status: 401, error: 'Token non valido', code: 'UNAUTHORIZED' };
  }
  if (!product || product.is_active !== true) {
    return { ok: false, status: 404, error: 'Prodotto non trovato', code: 'PRODUCT_NOT_FOUND' };
  }
  if (!version || version.is_active !== true) {
    return { ok: false, status: 404, error: 'Versione non trovata', code: 'VERSION_NOT_FOUND' };
  }
  return { ok: true };
}

module.exports = { authorizeCatalogProvision };
