// ─── Decisioni pure di autorizzazione — backend/routes/stripe.js ──────────
// Estratte da /update-app-fee e /sync-plan (Fase 3, Priorità 2) per
// renderle testabili con node:test senza Express/Supabase/Stripe reali —
// stesso pattern di backend/lib/stripe-webhook-logic.js e
// frontend/src/lib/cancel-subscription-authorization.js. Nessun I/O: le
// route eseguono le query nello stesso ordine/short-circuit di prima e
// passano qui solo i risultati già risolti; queste funzioni decidono
// soltanto se procedere e con quale status/errore altrimenti. Stessi
// status/messaggi già in uso nelle route prima di questa estrazione —
// nessun cambio di contratto per il chiamante legittimo.

// POST /api/update-app-fee
function authorizeUpdateAppFee({ user, tenantId, action, membership }) {
  if (!user) {
    return { ok: false, status: 401, error: 'Non autorizzato' };
  }
  if (!tenantId || !action) {
    return { ok: false, status: 400, error: 'tenantId e action obbligatori' };
  }
  // Ownership: 'action' arriva da qualunque chiamante senza controllo di
  // ruolo — solo un membro del tenant (qualunque ruolo, la route non lo
  // distingue) può richiedere il ricalcolo, mai un utente estraneo.
  if (!membership) {
    return { ok: false, status: 403, error: 'Non autorizzato' };
  }
  return { ok: true };
}

// POST /api/sync-plan
function authorizeSyncPlan({ user, sessionId, tenantId, membership, tenantByOwner }) {
  if (!user) {
    return { ok: false, status: 401, error: 'Non autorizzato' };
  }
  if (!sessionId) {
    return { ok: false, status: 400, error: 'sessionId mancante' };
  }
  if (!tenantId) {
    return { ok: false, status: 400, error: 'tenant_id mancante nella sessione' };
  }
  // Ownership a doppio percorso (vedi commento originale nella route): un
  // tenant trovato per owner_id non ha sempre una riga tenant_members
  // corrispondente — membership OPPURE proprietà diretta del tenant, non
  // serve entrambe.
  const authorized = !!membership || !!tenantByOwner;
  if (!authorized) {
    return { ok: false, status: 403, error: 'Tenant non autorizzato' };
  }
  return { ok: true };
}

module.exports = { authorizeUpdateAppFee, authorizeSyncPlan };
