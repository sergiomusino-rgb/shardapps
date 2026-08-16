// ─── Harness condiviso per i test HTTP delle route Creator ─────────────────
// (CreatorAI Engine 2.0 — hardening post-DONE, blocco 1/2)
//
// Importa le route REALI (app/api/creator/**/route.ts) così come sono
// spedite in produzione — nessuna riscrittura, nessuna funzione estratta ad
// hoc — e ne invoca gli handler POST/GET con vere NextRequest, sostituendo
// solo i DUE confini realmente esterni:
// - "@supabase/supabase-js" -> fake in-memory (test-helpers/fake-supabase.ts,
//   già usato dai test di modulo Fase 5/6, qui riusato invariato);
// - "@/src/lib/ai-router" -> stesso modulo REALE (extractJsonFromAiContent,
//   AiRouterError, AiRouterConfigError restano quelli veri, così anche gli
//   `instanceof` nelle route funzionano) con `callAiRouter` sostituita da una
//   coda di risposte configurabili dal test. MAI una chiamata di rete verso
//   OpenRouter/Groq.
// ENTRAMBI i redirect passano dal resolve hook STABILE di
// route-test-loader.mjs (fake-supabase-module.ts / fake-ai-router-module.ts),
// non da mock.module(): vedi il commento in testa a route-mock-state.ts per
// il perché — mock.module() con l'opzione `exports` è rotto su Node 22.x
// per entrambi questi specifier ("does not provide an export named ..."),
// mai su Node 24.x (fix per la CI, PR #24).
// Tutto il resto (design system loader, orchestrator, patch engine,
// validator, ecc.) gira TALE E QUALE al codice di produzione.
//
// Non richiede più il flag --experimental-test-module-mocks: nessun
// mock.module() rimasto in questo file (era l'unico uso in tutto il
// frontend), quindi il flag è stato rimosso anche dallo script "test" di
// package.json. Il loader di risoluzione alias (route-test-loader.mjs)
// resta comunque necessario — API stabile, non richiede alcun flag — ed è
// registrato una volta sola per processo qui sotto.
//
// Perché lo stato dei fake è registrato/riassegnato UNA VOLTA per test, non
// ricreato ad ogni richiesta: `currentSupabase`/`currentAiHandler` (vedi
// route-mock-state.ts) vengono riassegnati da ogni singolo test in
// setupRouteTest() — node:test esegue i test di un file in sequenza
// (nessuna concorrenza qui), quindi non c'è alcuna race tra la
// riassegnazione di un test e le richieste HTTP del test precedente, già
// tutte completate.

import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeFakeSupabase, type FakeSupabaseOptions } from './fake-supabase.ts';
import { setCurrentSupabaseForTests, setCurrentAiHandlerForTests, type FakeAiCall } from './route-mock-state.ts';
import type { AiRouterCallOptions } from '../ai-router.ts';

const FRONTEND_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../../');

let loaderRegistered = false;
function ensureRouteAliasLoader() {
  if (loaderRegistered) return;
  register(pathToFileURL(path.join(FRONTEND_ROOT, 'src/lib/test-helpers/route-test-loader.mjs')).href, import.meta.url);
  loaderRegistered = true;
}

export interface RouteTestSetup {
  supabase: ReturnType<typeof makeFakeSupabase>;
  /** Chiamate reali intercettate a callAiRouter, in ordine — utile per
   * asserire quale tier/task è stato invocato senza dipendere dai dettagli
   * del prompt. */
  aiCalls: AiRouterCallOptions[];
}

/**
 * Configura Supabase (fake in-memory) + ai-router (coda di risposte) per il
 * test corrente. Nessun parametro `t` richiesto (i fake sono condivisi per
 * processo tramite route-mock-state.ts, vedi sopra) — mantenuto comunque
 * nella firma per un'API stabile e per eventuali futuri usi di TestContext,
 * es. diagnostica.
 *
 * `aiResponses`: coda di risposte per callAiRouter, consumate in ordine di
 * chiamata (una per ogni chiamata AI attesa nel flusso della route — es.
 * planner poi generator per /generate, patch poi eventuale fallback per
 * /refactor). Se la coda si esaurisce, l'ultima risposta viene riusata
 * (comodo per i flussi con retry).
 */
export function setupRouteTest(
  _t: unknown,
  opts: {
    defaultsByTable?: Record<string, Record<string, unknown>>;
    seedTables?: Record<string, Record<string, unknown>[]>;
    rpcHandlers?: FakeSupabaseOptions['rpcHandlers'];
    authUsers?: FakeSupabaseOptions['authUsers'];
    aiResponses?: Array<{ content: string } | Error>;
  }
): RouteTestSetup {
  ensureRouteAliasLoader();

  const supabase = makeFakeSupabase(opts.defaultsByTable || {}, opts.seedTables || {}, {
    rpcHandlers: opts.rpcHandlers,
    authUsers: opts.authUsers,
  });
  setCurrentSupabaseForTests(supabase);

  const queue = [...(opts.aiResponses || [])];
  const aiCalls: AiRouterCallOptions[] = [];
  const aiHandler: FakeAiCall = async (options) => {
    aiCalls.push(options);
    const next = queue.length > 1 ? queue.shift()! : queue[0];
    if (next instanceof Error) throw next;
    if (!next) {
      throw new Error('setupRouteTest: nessuna risposta AI configurata per questa chiamata (coda aiResponses esaurita)');
    }
    return {
      content: next.content,
      task: options.task,
      tier: 'fast',
      model: 'test-fake-model',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
    };
  };
  setCurrentAiHandlerForTests(aiHandler);

  return { supabase, aiCalls };
}

/**
 * Import "fresco" di una route (bypassa la cache dei moduli ESM così ogni
 * test riparte da un modulo appena valutato, con `createClient()` che
 * intercetta il fake configurato PER QUEL test — indispensabile perché le
 * route creano il client Supabase una sola volta, a livello di modulo, al
 * primo import).
 */
export async function importRoute(relPathFromFrontendRoot: string): Promise<Record<string, unknown>> {
  const abs = path.join(FRONTEND_ROOT, relPathFromFrontendRoot);
  const url = `${pathToFileURL(abs).href}?t=${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return import(url);
}

export function authHeaders(token: string): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${token}` };
}
