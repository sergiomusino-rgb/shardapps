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

// ─── Audit pre-lancio 2026-08-14, BLOCKER #2 — revoca accesso post-cancel ──
// apps.status è l'unica source of truth del lifecycle di fatturazione (per
// le app-cliente reseller E per le Catalog Instance, che lo rispecchiano su
// subscription_status — vedi commento su updateAppStatus in
// stripe-webhook-handler.js): il webhook Stripe lo aggiorna correttamente a
// 'canceled'/'past_due' quando l'abbonamento non è più in regola, ma prima
// di questa patch il gate che protegge le API dati (clientAuthMiddleware,
// sotto) controllava SOLO client_active/expires_at — mai status. Per una
// Catalog Instance, il provisioning non valorizza mai expires_at (resta
// sempre NULL) e client_active resta true: un cliente che cancella
// l'abbonamento manteneva quindi accesso indefinito alle API dati,
// nonostante il webhook avesse scritto correttamente 'canceled'.
//
// Stessa soglia già applicata lato client (frontend/app/a/[slug]/
// AppLayoutClient.tsx, requiresPaywall): 'past_due'/'canceled'/'expired'
// bloccano, 'trial'/'active' (e qualunque altro valore, incluso null/
// undefined) restano sempre consentiti — apps.status ha DEFAULT 'trial', per
// cui nessuna app che non è mai passata da un ciclo di fatturazione
// (comandi_ai plain, CreatorAI non-Catalog, app reseller pre-Stripe) viene
// mai bloccata da qui. Un'unica soglia condivisa, usata solo da
// clientAuthMiddleware (il gate reale delle API dati) per non introdurre
// duplicazioni sparse — NON applicata alla route di login legacy
// (POST /a/:slug), che non restituisce dati di business, solo config/
// branding, e il cui comportamento resta quello esistente.
const BLOCKED_APP_STATUSES = new Set(['past_due', 'canceled', 'expired']);
function isAppBillingBlocked(app) {
  return BLOCKED_APP_STATUSES.has(app?.status);
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

// ─── FASE 3 — CreatorAI multi-utente (auth_mode='rbac') ────────────────────
// Tabella dedicata app_rbac_users (migration 20260812000000), indipendente
// da app_credentials: un'app rbac ha PIÙ righe, una per utente (email+
// password+ruolo), mentre app_credentials resta la credenziale unica
// condivisa delle app legacy — separarle evita di dover cambiare la PK/i
// vincoli di app_credentials (su cui altri punti del codice fanno upsert con
// onConflict:'app_id', vedi commento nella migration). Stesso identico
// modello di sicurezza del legacy (password in chiaro, nessun hashing/JWT):
// qui si estende solo lo scope da "1 password per app" a "1 password per
// utente", non il livello di sicurezza della verifica.
async function getRbacCredential(supabase, appId, email) {
  if (!email) return null;
  // Confronto case-insensitive senza operatori con wildcard (ilike userebbe
  // %/_ dell'email come pattern se non escapati): l'email è normalizzata in
  // minuscolo qui e alla scrittura (publish/route.ts), un semplice eq basta
  // e resta coerente con l'indice unico su lower(client_email) della migration.
  const { data } = await supabase
    .from('app_rbac_users')
    .select('client_password, role, client_email')
    .eq('app_id', appId)
    .eq('client_email', String(email).trim().toLowerCase())
    .maybeSingle();
  return data || null;
}

// Risolve l'identità del chiamante per un'app, in uno dei 4 modelli esistenti:
// comandi_ai (JWT + tenant_members), auth_mode='supabase' (JWT + app_users),
// auth_mode='rbac' (Bearer "email:password" + app_credentials multi-riga,
// Fase 3 CreatorAI — vedi getRbacCredential sopra), legacy (password
// condivisa via Bearer). Precedenza comandi_ai > supabase > rbac > legacy:
// le prime tre erano già così (identica a verifyClientAuth), rbac si inserisce
// prima del fallback legacy perché i due si escludono a vicenda per
// app.auth_mode (un'app è o rbac o legacy, mai entrambe).
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

  if (app.auth_mode === 'rbac') {
    // Token = "<email>:<password>" (vedi getRbacCredential sopra per il
    // perché di questo formato): email fino ai primi due punti, password il
    // resto — indexOf invece di split('.') per non troncare una password che
    // contenga ':' (indexOf prende il PRIMO, quindi solo l'email non può
    // contenerne — accettabile, un indirizzo email valido non ha ':').
    const sep = token.indexOf(':');
    if (sep === -1) {
      return { ok: false, status: 401, error: 'Credenziali non valide' };
    }
    const email = token.slice(0, sep);
    const password = token.slice(sep + 1);

    const credential = await getRbacCredential(supabase, appId, email);
    if (!credential || credential.client_password !== password) {
      return { ok: false, status: 401, error: 'Credenziali non valide' };
    }

    // appUserEmail (Security Audit Fase 4, Focus 5 — attribution): usa
    // credential.client_email (la forma canonica salvata, già lowercase) e
    // non l'`email` grezza estratta dal token, per non propagare
    // un'eventuale variante di maiuscole/minuscole diversa nel log di audit.
    return {
      ok: true, mode: 'rbac', tenantId: app.tenant_id, appId,
      appUserRole: credential.role, appUserEmail: credential.client_email,
    };
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
    .select('id, tenant_id, client_password, client_active, expires_at, auth_mode, app_type, status')
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

  // BLOCKER #2 (vedi commento su BLOCKED_APP_STATUSES sopra): un abbonamento
  // cancellato/non pagato deve bloccare l'accesso alle API dati anche
  // quando client_active/expires_at non l'hanno ancora fatto (Catalog
  // Instance con expires_at sempre NULL, o app-cliente reseller la cui
  // finestra di expires_at non coincide col periodo di fatturazione Stripe).
  if (isAppBillingBlocked(app)) {
    return res.status(403).json({ error: 'Abbonamento non attivo' });
  }

  const result = await resolveClientIdentity(supabase, app, appId, token);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  req.tenantId = result.tenantId;
  req.appId = result.appId;
  if (result.appUserRole !== undefined) req.appUserRole = result.appUserRole;
  if (result.clientPassword !== undefined) req.clientPassword = result.clientPassword;
  // Security Audit Fase 4, Focus 5 — attribution: solo per auth_mode='rbac'
  // (le app legacy non hanno un concetto di utente individuale, resta
  // undefined lì). Usato da action-dispatcher.js per popolare actor_email
  // in app_action_logs.
  if (result.appUserEmail !== undefined) req.appUserEmail = result.appUserEmail;
  // Fase 4: usato dagli endpoint di gestione utenti (POST/GET/DELETE
  // .../users) per rifiutare la richiesta su app che non sono auth_mode='rbac'
  // — `app` è già in scope qui (fetchato sopra), nessuna query in più.
  req.authMode = app.auth_mode;
  next();
}

module.exports = {
  getSupabase,
  getClientCredentials,
  getRbacCredential,
  verifyLegacyPassword,
  resolveClientIdentity,
  clientAuthMiddleware,
  isAppBillingBlocked,
  BLOCKED_APP_STATUSES,
};
