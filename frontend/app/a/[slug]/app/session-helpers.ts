// Estrae il token da usare come Authorization Bearer verso le API dati
// (/api/client/apps/:id/...), a prescindere dalla modalità di autenticazione:
// - mode 'legacy' (app esistenti): il token è la password condivisa in chiaro.
// - mode 'supabase' (nuove app): il token è il JWT della sessione Supabase Auth.
// Il backend Express (clientAuthMiddleware) sa già distinguere i due casi
// leggendo apps.auth_mode.
export function getAuthToken(session: { mode?: 'legacy' | 'supabase'; password?: string; accessToken?: string }): string {
  return session.mode === 'supabase' ? (session.accessToken || '') : (session.password || '');
}
