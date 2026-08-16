// ─── Sostituto di '@/src/lib/ai-router' durante i test HTTP delle route ────
// (CreatorAI Engine 2.0 — fix compatibilità CI Node 22, PR #24)
//
// Caricato al posto del modulo reale SOLO grazie al redirect di
// route-test-loader.mjs (mai importato/risolto in produzione: quel loader è
// registrato esclusivamente da route-test-harness.ts, mai da
// next.config.ts o da altro codice spedito in produzione). Vedi il
// commento in testa a route-mock-state.ts per il "perché" di questo file
// al posto di mock.module('@/src/lib/ai-router', ...) (rotto su Node 22.x
// con lo stesso SyntaxError già osservato per '@supabase/supabase-js').
//
// Comportamento IDENTICO al precedente mock via mock.module(): re-esporta
// TUTTE le implementazioni reali del modulo (extractJsonFromAiContent,
// AiRouterError, AiRouterConfigError, ecc. — gli `instanceof` nelle route
// continuano a funzionare) e sostituisce SOLO callAiRouter con
// un'indirezione verso `currentAiHandler` (route-mock-state.ts),
// riassegnata ad ogni test da setupRouteTest(). MAI una chiamata di rete
// verso OpenRouter/Groq durante i test.

export * from '../ai-router.ts';

import { currentAiHandler } from './route-mock-state.ts';
import type { AiRouterCallOptions, AiRouterResult } from '../ai-router.ts';

export function callAiRouter(options: AiRouterCallOptions): Promise<AiRouterResult> | AiRouterResult {
  return currentAiHandler(options);
}
