// ─── Decisione pura di autorizzazione — POST /api/a/[slug]/mark-first-login ──
// Estratta dalla route (Fase 4B, Fix Finding #7) per renderla testabile con
// node:test senza Next.js/Supabase reali — stesso pattern già usato in
// cancel-subscription-authorization.js. Nessun I/O qui: la route esegue le
// query (Supabase auth.getUser, SELECT apps, SELECT tenant_members) nello
// stesso ordine e passa solo i risultati già risolti; questa funzione decide
// soltanto se procedere e con quale status/errore altrimenti.
//
// Ownership (fix Finding #7, audit Fase 4B: l'endpoint era pubblico e senza
// autenticazione — chiunque conoscesse lo slug pubblico dell'app poteva
// impostare owner_trial_ends_at, anticipando l'inizio della fee di 25€/mese
// a carico del tenant): l'utente autenticato deve essere owner o admin del
// tenant proprietario di QUESTA app (apps.tenant_id -> tenant_members),
// stesso vincolo già usato in catalog/import/route.ts e comandi-agents.ts —
// non app_users, perché le istanze Comandi AI non hanno mai righe in
// app_users (solo tenant_members, vedi comandi-provisioning.ts).
function authorizeMarkFirstLogin({ token, user, app, membership }) {
  if (!token) {
    return { ok: false, status: 401, error: 'Autenticazione richiesta' };
  }
  if (!user) {
    return { ok: false, status: 401, error: 'Token non valido' };
  }
  if (!app) {
    return { ok: false, status: 404, error: 'App non trovata' };
  }
  if (!membership) {
    return { ok: false, status: 403, error: 'Non autorizzato' };
  }
  return { ok: true };
}

module.exports = { authorizeMarkFirstLogin };
