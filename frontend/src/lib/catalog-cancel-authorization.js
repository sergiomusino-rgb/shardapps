// ─── Decisione pura di autorizzazione — POST /api/catalog/products/         ──
// ─── [productSlug]/cancel (App Catalog & Instance Model, STEP 4) ──────────
// Stesso pattern di cancel-subscription-authorization.js (a/[slug], cliente
// finale) MA autorizzazione tenant-side, non app_users: chi cancella una
// Catalog Instance è il tenant che l'ha attivata dalla dashboard ShardApps,
// non un cliente finale registrato su un'app pubblicata (le Catalog Instance
// nascono con auth_mode legacy/rbac, MAI 'supabase' — vedi STEP 3 — quindi
// non hanno mai una riga app_users da poter controllare).
//
// `instance` arriva già scoped per tenant_id+product_id dalla route (stessa
// query della checkout authorization sopra): un'istanza di un altro tenant
// non può MAI comparire qui per costruzione della query, non per un
// controllo fatto in questa funzione — nessun tenantId è mai accettato in
// input, stessa garanzia strutturale di authorizeCatalogProvision/
// authorizeCatalogCheckout.
function authorizeCatalogCancel({ token, user, instance }) {
  if (!token) {
    return { ok: false, status: 401, error: 'Autenticazione richiesta', code: 'UNAUTHORIZED' };
  }
  if (!user) {
    return { ok: false, status: 401, error: 'Token non valido', code: 'UNAUTHORIZED' };
  }
  if (!instance) {
    return { ok: false, status: 404, error: 'Istanza non trovata per questo tenant', code: 'INSTANCE_NOT_FOUND' };
  }
  // Difesa in profondità (la query che produce `instance` filtra già su
  // product_id di un prodotto del catalogo, quindi questo ramo non dovrebbe
  // mai poter scattare in produzione): questo endpoint cancella SOLO
  // abbonamenti di Catalog Instance, mai la disdetta generica di un'app
  // pubblicata (quella resta cancel-subscription/route.ts, invariata).
  if (!instance.product_id) {
    return { ok: false, status: 400, error: 'Questa app non è un\'istanza del catalogo', code: 'NOT_CATALOG_INSTANCE' };
  }
  if (!instance.stripe_subscription_id) {
    return { ok: false, status: 400, error: 'Nessun abbonamento attivo da cancellare', code: 'NO_ACTIVE_SUBSCRIPTION' };
  }
  return { ok: true };
}

module.exports = { authorizeCatalogCancel };
