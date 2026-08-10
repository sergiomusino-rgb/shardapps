const { createClient } = require('@supabase/supabase-js');

// ─── FASE 4B, Finding #6 — consolidamento autenticazione cliente ───────────
// Prima di questo modulo, la stessa logica (confronto password legacy,
// verifica JWT+app_users, verifica JWT+tenant_members) era duplicata in
// backend/routes/client-app.js (clientAuthMiddleware + verifyClientAuth) e
// backend/routes/custom-tables.js (clientAuthMiddleware, copia letterale).
// Questo modulo è un refactor security-neutral: stessi identici controlli,
// stessi status/messaggi HTTP per ogni chiamante esistente — vedi il report
// FASE 4B Finding #6 per la matrice comportamento prima/dopo e le divergenze
// verificate. In particolare:
// - i controlli client_active/expires_at RESTANO fuori da questo modulo,
//   a carico del chiamante, per preservare esattamente le differenze già
//   esistenti tra clientAuthMiddleware (li applica) e verifyClientAuth
//   (non li applica, comportamento invariato per /a/:slug/settings);
// - il ramo app_type='comandi_ai' è nuovo in clientAuthMiddleware (prima
//   assente, le app comandi_ai — auth_mode sempre 'legacy' — ricadevano nel
//   ramo legacy ottenendo sempre 401): stessa identica logica già in uso in
//   verifyClientAuth, nessun privilegio nuovo, corregge un caso oggi rotto
//   ma non raggiunto dal flusso applicativo reale (vedi report);
// - change-password NON usa resolveClientIdentity: non ha mai avuto branching
//   per auth_mode/app_type (nessun Bearer/JWT in gioco, la "prova" è la
//   vecchia password nel body), e non lo introduciamo ora — resta legacy-only
//   come oggi, tramite verifyLegacyPassword.

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );
}

// Le credenziali client vivono in app_credentials (mai esposta alla Data API
// pubblica, vedi 20260808000004_app_credentials_table.sql), con
// apps.client_password/initial_password come fallback finché la migration di
// pulizia finale non le azzera. Identica in precedenza in client-app.js e
// custom-tables.js.
async function getClientCredentials(supabase, appId, fallback) {
  const { data } = await supabase
    .from('app_credentials')
    .select('client_password, initial_password')
    .eq('app_id', appId)
    .maybeSingle();

  return {
    client_password: data?.client_password ?? fallback?.client_password ?? null,
    initial_password: data?.initial_password ?? fallback?.initial_password ?? null,
  };
}

// Confronto della password legacy (client_password condiviso dell'app)
// contro un valore fornito — usato sia da un Bearer token (clientAuthMiddleware
// legacy, verifyClientAuth legacy) sia da un campo del body (change-password,
// che non usa affatto un Bearer/JWT: la prova di possesso è la vecchia
// password stessa).
async function verifyLegacyPassword(supabase, app, providedValue) {
  const creds = await getClientCredentials(supabase, app.id, app);
  return creds.client_password === providedValue;
}

// Risolve l'identità del chiamante per un'app, nei 3 modelli esistenti:
// comandi_ai (JWT + tenant_members), auth_mode='supabase' (JWT + app_users),
// legacy (password condivisa via Bearer). Precedenza comandi_ai > supabase >
// legacy, identica a quella già usata da verifyClientAuth.
//
// Input: supabase client (service role), `app` (deve avere almeno
// id/tenant_id/app_type/auth_mode/client_password), `appId` (id dell'app,
// esplicito perché i chiamanti lo ottengono in modi diversi: da req.params in
// clientAuthMiddleware, da app.id in verifyClientAuth), `token` (Bearer già
// estratto, MAI null/vuoto — i chiamanti gestiscono da sé il caso "nessun
// token", con il proprio messaggio/status esistente, invariato).
//
// Output: { ok: true, mode, tenantId, appId, appUserRole?, clientPassword? }
//      oppure { ok: false, status, error }
//
// Non applica alcun controllo di client_active/expires_at: resta a carico
// del chiamante (vedi nota sopra sul perché).
async function resolveClientIdentity(supabase, app, appId, token) {
  if (app.app_type === 'comandi_ai') {
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return { ok: false, status: 401, error: 'Utente non autenticato' };
    }

    const { data: membership } = await supabase
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', user.id)
      .eq('tenant_id', app.tenant_id)
      .maybeSingle();

    if (!membership) {
      return { ok: false, status: 403, error: 'Utente non autorizzato per questa app' };
    }

    return { ok: true, mode: 'comandi_ai', tenantId: app.tenant_id, appId };
  }

  if (app.auth_mode === 'supabase') {
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return { ok: false, status: 401, error: 'Utente non autenticato' };
    }

    const { data: appUser, error: appUserError } = await supabase
      .from('app_users')
      .select('role, is_active')
      .eq('user_id', user.id)
      .eq('app_id', appId)
      .eq('is_active', true)
      .single();

    if (appUserError || !appUser) {
      return { ok: false, status: 403, error: 'Utente non autorizzato per questa app' };
    }

    return { ok: true, mode: 'supabase', tenantId: app.tenant_id, appId, appUserRole: appUser.role };
  }

  // Legacy: confronto password in chiaro, comportamento invariato.
  const validPassword = await verifyLegacyPassword(supabase, app, token);
  if (!validPassword) {
    return { ok: false, status: 401, error: 'Password errata' };
  }

  return { ok: true, mode: 'legacy', tenantId: app.tenant_id, appId, clientPassword: token };
}

// Middleware Express pronto all'uso — prima duplicato letteralmente in
// client-app.js e custom-tables.js (stesso codice, verificato con diff).
// Contratto HTTP identico a entrambe le copie precedenti, con l'aggiunta del
// ramo comandi_ai (vedi nota in testa al file).
async function clientAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Autenticazione mancante' });
  }

  const token = authHeader.substring(7);
  const { appId } = req.params;

  const supabase = getSupabase();

  const { data: app, error } = await supabase
    .from('apps')
    .select('id, tenant_id, client_password, client_active, expires_at, auth_mode, app_type')
    .eq('id', appId)
    .single();

  if (error || !app) {
    return res.status(404).json({ error: 'App non trovata' });
  }

  if (app.client_active === false) {
    return res.status(403).json({ error: 'App bloccata' });
  }

  if (app.expires_at && new Date(app.expires_at) < new Date()) {
    return res.status(403).json({ error: 'App scaduta' });
  }

  const result = await resolveClientIdentity(supabase, app, appId, token);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  req.tenantId = result.tenantId;
  req.appId = result.appId;
  if (result.appUserRole !== undefined) req.appUserRole = result.appUserRole;
  if (result.clientPassword !== undefined) req.clientPassword = result.clientPassword;
  next();
}

module.exports = {
  getSupabase,
  getClientCredentials,
  verifyLegacyPassword,
  resolveClientIdentity,
  clientAuthMiddleware,
};
