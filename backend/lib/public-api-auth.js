// ─── Data Export + Public API — autenticazione tramite API key ─────────────
// Middleware per la Public API v1 (/api/v1/apps/:appId/..., routes/
// public-api.js): autentica "Authorization: Bearer <API_KEY>" invece del JWT
// Supabase/password condivisa già gestiti da lib/client-auth.js. Stesso
// output di clientAuthMiddleware verso i chiamanti a valle (req.appId/
// req.tenantId), così le route della Public API possono restare identiche
// nello spirito a quelle già esistenti in custom-tables.js/app-records.js —
// solo l'autenticazione cambia, non il modello di isolamento tenant_id/app_id.
//
// getSupabase/isAppBillingBlocked sono riusati da client-auth.js (nessuna
// duplicazione, nessuna modifica a quel file).

const { getSupabase, isAppBillingBlocked } = require('./client-auth');
const { hashApiKey, looksLikeApiKey } = require('./api-key-crypto');

// Risolve una chiave grezza in una riga app_api_keys valida (non revocata,
// non scaduta). Pura rispetto a req/res: testabile passando un fake supabase
// (vedi public-api-auth.test.js), stesso principio di resolveClientIdentity
// in client-auth.js.
async function resolveApiKey(supabase, rawKey) {
  if (!looksLikeApiKey(rawKey)) {
    return { ok: false, status: 401, error: 'API key non valida' };
  }

  const keyHash = hashApiKey(rawKey);
  const { data: keyRow, error } = await supabase
    .from('app_api_keys')
    .select('id, app_id, tenant_id, scopes, expires_at, revoked_at, last_used_at')
    .eq('key_hash', keyHash)
    .maybeSingle();

  // Stesso messaggio generico per "chiave inesistente" e "chiave malformata"
  // (sopra): non deve mai trapelare se una chiave sintatticamente valida
  // esiste o meno nel DB.
  if (error || !keyRow) {
    return { ok: false, status: 401, error: 'API key non valida' };
  }

  if (keyRow.revoked_at) {
    return { ok: false, status: 401, error: 'API key revocata' };
  }

  if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) {
    return { ok: false, status: 401, error: 'API key scaduta' };
  }

  return { ok: true, keyRow };
}

// Decisione pura (nessun I/O) che vincola una chiave già risolta alla sua
// app: estratta a parte, sullo stesso principio di
// stripe-route-authorization.js::authorizeUpdateAppFee, per essere
// testabile con dati finti senza un vero client Supabase (vedi
// public-api-auth.test.js). Copre i due requisiti CRITICI della Fase 3:
// - una chiave emessa per l'app A non deve MAI autorizzare l'app B, anche
//   nello stesso path/tenant;
// - un'app spostata di tenant o billing-blocked deve invalidare la chiave,
//   anche se la chiave stessa non è né revocata né scaduta.
function authorizeKeyForApp(keyRow, appId, app) {
  if (appId !== keyRow.app_id) {
    return { ok: false, status: 403, error: 'API key non valida per questa app' };
  }
  if (!app || app.tenant_id !== keyRow.tenant_id) {
    return { ok: false, status: 404, error: 'App non trovata' };
  }
  if (isAppBillingBlocked(app)) {
    return { ok: false, status: 403, error: 'Abbonamento non attivo' };
  }
  return { ok: true };
}

// Middleware Express pronto all'uso — da montare su ogni route sotto
// /api/v1/apps/:appId. CRITICO (Fase 3 del task): una API key è vincolata a
// UNA sola app in fase di creazione (app_api_keys.app_id). Se il path
// richiede un'app diversa da quella della chiave, la richiesta è rifiutata
// con 403 — nessuna chiave può mai leggere/scrivere dati di un'altra app,
// anche all'interno dello stesso tenant.
async function requireApiKey(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Autenticazione mancante. Usa: Authorization: Bearer <API_KEY>' });
  }

  const rawKey = authHeader.slice(7).trim();
  const { appId } = req.params;
  if (!appId) {
    return res.status(400).json({ error: 'appId mancante nel percorso' });
  }

  const supabase = getSupabase();
  const result = await resolveApiKey(supabase, rawKey);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  const { keyRow } = result;

  // Verifica aggiuntiva (difesa in profondità) che l'app esista ancora, non
  // sia stata spostata su un altro tenant, e non sia billing-blocked — stessa
  // soglia già applicata da clientAuthMiddleware per l'accesso via password.
  const { data: app, error: appError } = await supabase
    .from('apps')
    .select('id, tenant_id, status, client_active, expires_at')
    .eq('id', appId)
    .maybeSingle();

  if (appError && !app) {
    return res.status(404).json({ error: 'App non trovata' });
  }

  const authz = authorizeKeyForApp(keyRow, appId, app);
  if (!authz.ok) {
    return res.status(authz.status).json({ error: authz.error });
  }

  req.appId = appId;
  req.tenantId = keyRow.tenant_id;
  req.apiKeyId = keyRow.id;
  req.apiKeyScopes = Array.isArray(keyRow.scopes) && keyRow.scopes.length > 0 ? keyRow.scopes : ['read'];

  // last_used_at: aggiornamento "best effort", MAI atteso (non deve
  // rallentare la risposta) e il suo fallimento non deve mai far fallire la
  // richiesta autenticata — è solo un dato informativo per la dashboard.
  supabase
    .from('app_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', keyRow.id)
    .then(
      () => {},
      () => {}
    );

  next();
}

// Fase 7 — scope read/write: da comporre dopo requireApiKey (richiede
// req.apiKeyScopes già popolato). Una chiave read-only ottiene 403 su
// scritture (POST/PATCH/DELETE); read+write passa ovunque.
function requireScope(scope) {
  return function requireScopeMiddleware(req, res, next) {
    const scopes = req.apiKeyScopes || [];
    if (!scopes.includes(scope)) {
      return res.status(403).json({ error: `Questa API key non ha lo scope richiesto: '${scope}'` });
    }
    next();
  };
}

module.exports = { requireApiKey, requireScope, resolveApiKey, authorizeKeyForApp };
