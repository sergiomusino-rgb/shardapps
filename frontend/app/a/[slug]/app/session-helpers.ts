// Estrae il token da usare come Authorization Bearer verso le API dati
// (/api/client/apps/:id/...), a prescindere dalla modalità di autenticazione:
// - mode 'legacy' (app esistenti): il token è la password condivisa in chiaro.
// - mode 'supabase' (nuove app): il token è il JWT della sessione Supabase Auth.
// - mode 'rbac' (Fase 3): il token è il composito "email:password" restituito
//   dal login (vedi backend/routes/client-app.js) e già salvato in
//   session.password — stesso branch di 'legacy', nessuna logica in più qui.
// Il backend Express (clientAuthMiddleware) sa già distinguere i casi
// leggendo apps.auth_mode.
export function getAuthToken(session: { mode?: 'legacy' | 'supabase' | 'rbac'; password?: string; accessToken?: string }): string {
  return session.mode === 'supabase' ? (session.accessToken || '') : (session.password || '');
}
