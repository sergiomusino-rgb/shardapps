// ─── Decisione pura di autorizzazione — GET /api/generate/status,          ──
// ─── GET /api/generate/project (Fase 5B, fix Totalum API key exposure) ────
// Stesso pattern di cancel-subscription-authorization.js e
// mark-first-login-authorization.js: nessun I/O qui, la route esegue le
// query (Supabase auth.getUser, SELECT totalum_generation_requests, SELECT
// tenant_members) e passa solo i risultati già risolti; questa funzione
// decide soltanto se procedere e con quale status/errore altrimenti.
//
// Ownership (fix Fase 5A: la pagina di attesa chiamava Totalum direttamente
// dal browser con una chiave duplicata in NEXT_PUBLIC_TOTALUM_API_KEY,
// quindi presente in chiaro nel bundle pubblico, e senza alcun controllo che
// il projectId richiesto appartenesse al chiamante): l'utente autenticato
// deve essere lo stesso che ha creato il progetto (ownershipRow.user_id) O
// un membro dello stesso tenant (ownershipRow.tenant_id, nullable per il
// bypass ADMIN_USER_ID di generate/route.ts, che non risolve un tenant).
function authorizeTotalumGenerationAccess({ token, user, ownershipRow, callerTenantId }) {
  if (!token) {
    return { ok: false, status: 401, error: 'Autenticazione richiesta' };
  }
  if (!user) {
    return { ok: false, status: 401, error: 'Token non valido' };
  }
  if (!ownershipRow) {
    return { ok: false, status: 404, error: 'Progetto non trovato' };
  }

  const sameUser = ownershipRow.user_id === user.id;
  const sameTenant =
    ownershipRow.tenant_id != null &&
    callerTenantId != null &&
    ownershipRow.tenant_id === callerTenantId;

  if (!sameUser && !sameTenant) {
    return { ok: false, status: 403, error: 'Non autorizzato' };
  }
  return { ok: true };
}

module.exports = { authorizeTotalumGenerationAccess };
