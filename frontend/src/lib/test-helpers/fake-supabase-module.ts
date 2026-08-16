// ─── Sostituto di '@supabase/supabase-js' durante i test HTTP delle route ──
// (CreatorAI Engine 2.0 — fix compatibilità CI Node 22, PR #24)
//
// Caricato al posto del pacchetto reale SOLO grazie al redirect di
// route-test-loader.mjs (mai importato/risolto in produzione: quel loader è
// registrato esclusivamente da route-test-harness.ts, mai da
// next.config.ts o da altro codice spedito in produzione). Vedi il
// commento in testa a route-mock-state.ts per il "perché" di questo file
// al posto di mock.module('@supabase/supabase-js', ...) (rotto su Node
// 22.x per questo specifico pacchetto dual ESM/CJS).
//
// Comportamento IDENTICO al precedente mock via mock.module(): solo
// createClient è realmente usato dalle route/lib coinvolte. La maggior
// parte delle route la chiama con firma/generic diversi
// (createClient<Database>(url, serviceRoleKey)) e nessuna opzione
// "global.headers" — per quelle ritorna sempre `currentSupabase`,
// riassegnata ad ogni test da setupRouteTest() (route-test-harness.ts), così
// ogni modulo del grafo di import (route, creator-server.ts, rate-limit.ts,
// comandi-provisioning.ts) condivide lo stesso DB in memoria del test in
// corso.
//
// Alcune route (es. app/api/apps/[id]/route.ts) creano invece un client
// "authClient" dedicato con createClient(url, anonKey, {global:{headers:
// {Authorization:'Bearer <token>'}}}) e poi chiamano .auth.getUser() SENZA
// argomenti (il vero @supabase/supabase-js usa il token catturato in
// quell'header) — pattern diverso da getUserFromToken(supabase, token)
// (creator-server.ts), che passa il token esplicitamente ad ogni chiamata e
// per cui il fake sotto basta già. Per supportare ANCHE il primo pattern,
// quando createClient riceve quell'header intercettiamo SOLO
// .auth.getUser() con un wrapper che inoltra il token catturato al fake
// condiviso (findAppVersionForTenant ecc. restano sullo stesso
// `currentSupabase.from(...)`, nessun DB separato).

import { currentSupabase } from './route-mock-state.ts';

export function createClient(
  _url?: string,
  _key?: string,
  options?: { global?: { headers?: Record<string, string> } }
) {
  const authHeader = options?.global?.headers?.Authorization || options?.global?.headers?.authorization;
  const capturedToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  if (!capturedToken || !currentSupabase) return currentSupabase;
  const base = currentSupabase;
  return {
    ...base,
    auth: {
      ...base.auth,
      getUser: (explicitToken?: string) => base.auth.getUser(explicitToken ?? capturedToken),
    },
  };
}
