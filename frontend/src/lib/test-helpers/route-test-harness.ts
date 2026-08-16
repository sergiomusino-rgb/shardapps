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
// Tutto il resto (design system loader, orchestrator, patch engine,
// validator, ecc.) gira TALE E QUALE al codice di produzione.
//
// Richiede il flag --experimental-test-module-mocks (node:test mock.module)
// e il loader di risoluzione alias (route-test-loader.mjs, registrato una
// volta sola per processo qui sotto).
//
// Perché i mock sono registrati UNA SOLA VOLTA per processo (mock.module
// globale, non t.mock.module per-test): l'auto-restore di t.mock.module tra
// test dello stesso file, quando più test dello stesso file mockano LO
// STESSO specifier ("@/src/lib/ai-router"/"@supabase/supabase-js"), si è
// rivelato inaffidabile in pratica con questa API ancora sperimentale (un
// test successivo può ritrovarsi a intercettare ancora la coda di risposte
// AI/il fake Supabase di un test precedente già esaurito, con fallimenti
// intermittenti dipendenti dall'ordine). Soluzione più robusta: un solo
// mock.module per specifier per l'intero processo, che delega a
// un'indirezione mutabile (`currentSupabase`/`currentAiHandler`)
// riassegnata da ogni singolo test in setupRouteTest() — node:test esegue i
// test di un file in sequenza (nessuna concorrenza qui), quindi non c'è
// alcuna race tra la riassegnazione di un test e le richieste HTTP del test
// precedente, già tutte completate.

import { mock } from 'node:test';
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeFakeSupabase, type FakeSupabaseOptions } from './fake-supabase.ts';
import * as RealAiRouter from '../ai-router.ts';
import type { AiRouterCallOptions, AiRouterResult } from '../ai-router.ts';

const FRONTEND_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../../');

let loaderRegistered = false;
function ensureRouteAliasLoader() {
  if (loaderRegistered) return;
  register(pathToFileURL(path.join(FRONTEND_ROOT, 'src/lib/test-helpers/route-test-loader.mjs')).href, import.meta.url);
  loaderRegistered = true;
}

export type FakeAiCall = (options: AiRouterCallOptions) => Promise<AiRouterResult> | AiRouterResult;

// ─── Indirezione mutabile, riassegnata ad ogni setupRouteTest() ────────────
let currentSupabase: ReturnType<typeof makeFakeSupabase> | null = null;
let currentAiHandler: FakeAiCall = async () => {
  throw new Error('route-test-harness: setupRouteTest() non è stato chiamato prima di questa richiesta');
};
let globalMocksRegistered = false;

// @types/node non è ancora allineato al runtime su questo punto: Node
// accetta/preferisce `exports` in mock.module() (usare `namedExports`, il
// solo nome che il tipo installato conosce, produce un DeprecationWarning ad
// ogni chiamata — verificato empiricamente), ma MockModuleOptions qui non lo
// elenca ancora. `as any` mirato SOLO al parametro options di questa
// chiamata (TS rifiuta anche un cast diretto: "no properties in common",
// la regola sui weak type per un'interfaccia interamente opzionale) —
// nessun impatto sul type-checking del resto del file.
function ensureGlobalMocks() {
  if (globalMocksRegistered) return;
  ensureRouteAliasLoader();

  mock.module('@supabase/supabase-js', {
    // Solo createClient è realmente usato dalle route/lib coinvolte — le
    // route lo chiamano con firma/generic diversi (createClient<Database>(...)),
    // qui ignorati: ritorna sempre `currentSupabase`, riassegnata ad ogni
    // test, così ogni modulo del grafo di import (route, creator-server.ts,
    // rate-limit.ts, comandi-provisioning.ts) condivide lo stesso DB in
    // memoria del test in corso.
    exports: { createClient: () => currentSupabase },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vedi commento sopra ensureGlobalMocks
  } as any);

  mock.module('@/src/lib/ai-router', {
    // Spread del modulo REALE: extractJsonFromAiContent/AiRouterError/
    // AiRouterConfigError restano le implementazioni vere (gli `instanceof`
    // nelle route continuano a funzionare), solo callAiRouter è sostituita
    // da un'indirezione verso `currentAiHandler`, riassegnata ad ogni test.
    exports: { ...RealAiRouter, callAiRouter: (options: AiRouterCallOptions) => currentAiHandler(options) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vedi commento sopra ensureGlobalMocks
  } as any);

  globalMocksRegistered = true;
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
 * test corrente. Nessun parametro `t` richiesto (i mock sono globali per
 * processo, vedi sopra) — mantenuto comunque nella firma per un'API stabile
 * e per eventuali futuri usi di TestContext, es. diagnostica.
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
  ensureGlobalMocks();

  const supabase = makeFakeSupabase(opts.defaultsByTable || {}, opts.seedTables || {}, {
    rpcHandlers: opts.rpcHandlers,
    authUsers: opts.authUsers,
  });
  currentSupabase = supabase;

  const queue = [...(opts.aiResponses || [])];
  const aiCalls: AiRouterCallOptions[] = [];
  currentAiHandler = async (options) => {
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
