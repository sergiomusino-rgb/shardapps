// ─── Decisione pura di autorizzazione — POST /api/catalog/products/         ──
// ─── [productSlug]/checkout (App Catalog & Instance Model, STEP 4) ────────
// Stesso pattern di catalog-provision-authorization.js (STEP 3): nessun I/O
// qui, la route esegue le query (Supabase auth.getUser, SELECT app_products,
// SELECT apps scoped by tenant+product) e passa solo i risultati già
// risolti; questa funzione decide soltanto se procedere e con quale
// status/errore altrimenti.
//
// Differenza rispetto a catalog-provision-authorization.js: qui `instance`
// non viene mai creata, deve già esistere (provisionata dallo STEP 3) — il
// checkout fattura un'istanza esistente, non ne crea una nuova. `instance`
// arriva alla route già filtrata per tenant_id+product_id (stessa query
// idempotenza dello STEP 3): un'istanza di un altro tenant non può MAI
// comparire qui, per costruzione della query, non per un controllo fatto in
// questa funzione — questa funzione si fida che il chiamante l'abbia già
// scoped correttamente (mai un tenantId passato in input, stessa garanzia
// strutturale di authorizeCatalogProvision).
function authorizeCatalogCheckout({ token, user, product, instance }) {
  if (!token) {
    return { ok: false, status: 401, error: 'Autenticazione richiesta', code: 'UNAUTHORIZED' };
  }
  if (!user) {
    return { ok: false, status: 401, error: 'Token non valido', code: 'UNAUTHORIZED' };
  }
  // Stesso 404 uniforme di authorizeCatalogProvision: prodotto inesistente e
  // prodotto disattivato non devono essere distinguibili da un chiamante che
  // enumera slug.
  if (!product || product.is_active !== true) {
    return { ok: false, status: 404, error: 'Prodotto non trovato', code: 'PRODUCT_NOT_FOUND' };
  }
  if (!instance) {
    return {
      ok: false,
      status: 404,
      error: 'Nessuna istanza di questo prodotto per il tuo tenant. Attivala prima dal catalogo.',
      code: 'INSTANCE_NOT_FOUND',
    };
  }
  // "non abbia già una subscription attiva": apps.status è la source of
  // truth (decisione STEP 4) — 'active' significa che un abbonamento Stripe
  // sta già pagando questa istanza, un secondo checkout creerebbe una
  // seconda subscription per la stessa app.
  if (instance.status === 'active') {
    return { ok: false, status: 400, error: 'Abbonamento già attivo per questa istanza', code: 'ALREADY_ACTIVE' };
  }
  // Prezzo ESCLUSIVAMENTE da app_products.price_monthly (mai client_price/
  // zeusx_fee): un prodotto placeholder a 0.00€ (i tre seed FollowAI/CheckAI/
  // CommandAI dello STEP 3) non ha senso venderlo come subscription Stripe a
  // importo zero — errore esplicito invece di creare una Checkout Session
  // degenere.
  if (!(product.price_monthly > 0)) {
    return { ok: false, status: 400, error: 'Questo prodotto non richiede un abbonamento a pagamento', code: 'FREE_PRODUCT' };
  }
  return { ok: true };
}

module.exports = { authorizeCatalogCheckout };
