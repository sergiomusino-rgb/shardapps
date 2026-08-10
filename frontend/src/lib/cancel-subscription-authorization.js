// ─── Decisione pura di autorizzazione — POST /api/a/[slug]/cancel-subscription ──
// Estratta dalla route (Fase 3, Step 1.3) per renderla testabile con
// node:test senza Next.js/Supabase/Stripe reali — stesso pattern già usato
// in backend/lib/stripe-webhook-logic.js. Nessun I/O qui: la route esegue
// le query (Supabase auth.getUser, SELECT apps, SELECT app_users) nello
// stesso ordine di prima e passa solo i risultati già risolti; questa
// funzione decide soltanto se procedere e con quale status/errore
// altrimenti. Stessi status/messaggi già in uso nella route prima di
// questa estrazione — nessun cambio di contratto per il chiamante.
//
// Ownership (fix cross-tenant, caso 15 dell'audit Fase 3B): l'utente
// autenticato deve essere l'admin registrato di QUESTA specifica app —
// stesso vincolo imposto alla registrazione (register/route.ts). Un
// 'agent'/'viewer'/'editor' non gestisce la fatturazione.
function authorizeCancelSubscription({ token, user, app, appUser }) {
  if (!token) {
    return { ok: false, status: 401, error: 'Autenticazione richiesta' };
  }
  if (!user) {
    return { ok: false, status: 401, error: 'Token non valido' };
  }
  if (!app) {
    return { ok: false, status: 404, error: 'App non trovata' };
  }
  if (!appUser) {
    return { ok: false, status: 403, error: 'Non autorizzato' };
  }
  if (!app.stripe_subscription_id) {
    return { ok: false, status: 400, error: 'Nessun abbonamento attivo' };
  }
  return { ok: true };
}

module.exports = { authorizeCancelSubscription };
