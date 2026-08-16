// ─── Stato mutabile condiviso — per i redirect stabili di
// '@supabase/supabase-js' e '@/src/lib/ai-router' (route-test-loader.mjs) ──
// (CreatorAI Engine 2.0 — fix compatibilità CI Node 22, PR #24)
//
// Isolato in un file a parte, senza altri import "pesanti" (route-test-
// harness.ts importa fake-supabase.ts, node:test, ecc.): i moduli che
// PRENDONO IL POSTO di '@supabase/supabase-js' e '@/src/lib/ai-router'
// durante i test (vedi fake-supabase-module.ts e fake-ai-router-module.ts)
// devono restare piccoli e "innocui" da risolvere — nessun rischio di
// ciclo di import con route-test-harness.ts, che invece IMPORTA questo file
// (tramite i setter sotto) per riassegnare lo stato ad ogni
// setupRouteTest().
//
// PERCHÉ questo file esiste: su Node 22.x (verificato: 22.23.2, la stessa
// versione installata da actions/setup-node@v4 con node-version: '22' nel
// workflow CI — riprodotta in un container Docker pulito, node_modules
// installato da zero con lo stesso package-lock.json della CI, nessuna
// contaminazione da ambiente Windows) `mock.module(specifier,
// {exports:{...}})` fallisce al primo import reale da parte di una route
// con un SyntaxError tipo:
//   The requested module '@supabase/supabase-js' does not provide an
//   export named 'createClient'
//   The requested module './ai-router.ts' does not provide an export
//   named 'callAiRouter'
// sollevato da ModuleJob._instantiate — per ENTRAMBI gli specifier mockati
// da questa suite, non solo per pacchetti dual ESM/CJS di terzi come
// @supabase/supabase-js: verificato empiricamente eseguendo la suite
// completa in Docker, prima e dopo il fix. Su Node 24.18.0 (locale) lo
// stesso identico codice funziona senza problemi in entrambi i casi. La
// causa è nella costruzione interna — sperimentale e version-dependent —
// degli "export sintetici" che node:test genera per un modulo mockato con
// mock.module({exports:...}): un comportamento noto per essere ancora
// instabile in questa API (Stability 1 — Early development,
// --experimental-test-module-mocks), non un bug del nostro codice né una
// regressione introdotta da questa PR (il codice sorgente delle route è
// invariato dal commit 91a492c che ha introdotto l'harness).
//
// FIX: non usare più mock.module() per NESSUno dei due specifier. Il
// resolve hook STABILE già usato per gli alias "@/" (route-test-loader.mjs
// — Node module customization hook, module.register(), API stabile da
// Node 18.19/20.6) reindirizza entrambi verso i rispettivi fake — veri file
// .ts che leggono lo stato mutabile qui sotto tramite normali binding ESM
// "vivi" (live binding) — nessuna API sperimentale in questo percorso.

import type { makeFakeSupabase } from './fake-supabase.ts';
import type { AiRouterCallOptions, AiRouterResult } from '../ai-router.ts';

export type FakeAiCall = (options: AiRouterCallOptions) => Promise<AiRouterResult> | AiRouterResult;

export let currentSupabase: ReturnType<typeof makeFakeSupabase> | null = null;

export let currentAiHandler: FakeAiCall = async () => {
  throw new Error('route-test-harness: setupRouteTest() non è stato chiamato prima di questa richiesta');
};

/**
 * Chiamata da route-test-harness.ts in setupRouteTest(), una volta per
 * test: riassegna il fake Supabase in-memory che fake-supabase-module.ts
 * (il file che prende il posto di '@supabase/supabase-js' durante i test)
 * deve restituire da createClient(). Un setter, non un'esportazione
 * mutabile diretta, perché in ESM solo il modulo che dichiara un `let`
 * esportato può riassegnarlo — i moduli importatori (fake-supabase-
 * module.ts) ricevono comunque un binding "vivo": ogni lettura di
 * `currentSupabase` vede sempre il valore più recente impostato qui.
 */
export function setCurrentSupabaseForTests(fake: ReturnType<typeof makeFakeSupabase> | null): void {
  currentSupabase = fake;
}

/** Stesso motivo/meccanismo di setCurrentSupabaseForTests, per l'handler AI
 * usato da fake-ai-router-module.ts (redirect di '@/src/lib/ai-router'). */
export function setCurrentAiHandlerForTests(handler: FakeAiCall): void {
  currentAiHandler = handler;
}
