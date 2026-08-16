// ─── Loader di risoluzione moduli per i test HTTP delle route Creator ──────
// (CreatorAI Engine 2.0 — hardening post-DONE, blocco 1/2)
//
// Le route Next.js (app/api/creator/**/route.ts) usano gli alias di progetto
// ("@/src/lib/...", "@/lib/...", "@/types/...", definiti in tsconfig.json
// "paths": {"@/*": ["./*"]}) risolti dal bundler di Next.js/webpack, MAI da
// Node in esecuzione diretta (`node --test`) — che non legge tsconfig.json.
// Le suite Fase 0–6 esistenti hanno aggirato il problema scrivendo import
// SOLO relativi con estensione esplicita (vedi allowImportingTsExtensions in
// tsconfig.json), ma le route stesse — codice di produzione, non toccabile
// "senza necessità" per questo compito — usano `@/` ovunque. Questo loader
// (Node module customization hook, vedi module.register()) insegna a Node a
// risolvere quello stesso alias SENZA toccare un solo file sorgente delle
// route: stesso identico codice spedito in produzione, eseguito così com'è.
//
// Riusa esclusivamente API Node stabili per module.register (stabile da
// Node 20.6/18.19) — la sola parte sperimentale del setup di test è
// node:test mock.module (richiede --experimental-test-module-mocks), non
// questo loader.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// frontend/src/lib/test-helpers/route-test-loader.mjs -> frontend/
const FRONTEND_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../../');

const CANDIDATE_SUFFIXES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

function resolveAliasedPath(rel) {
  const base = path.join(FRONTEND_ROOT, rel);
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = base + suffix;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// '@supabase/supabase-js' e '@/src/lib/ai-router' durante i test: redirect
// stabile (via questo stesso resolve hook, non mock.module() — sperimentale
// e rotto su Node 22.x per ENTRAMBI questi specifier, "does not provide an
// export named ...", vedi il commento in testa a route-mock-state.ts) verso
// i rispettivi fake, veri file locali mai risolti/usati fuori dai test
// (questo loader è registrato solo da route-test-harness.ts, mai in
// produzione).
const SUPABASE_FAKE_URL = pathToFileURL(path.join(FRONTEND_ROOT, 'src/lib/test-helpers/fake-supabase-module.ts')).href;
const AI_ROUTER_REAL_URL = pathToFileURL(path.join(FRONTEND_ROOT, 'src/lib/ai-router.ts')).href;
const AI_ROUTER_FAKE_URL = pathToFileURL(path.join(FRONTEND_ROOT, 'src/lib/test-helpers/fake-ai-router-module.ts')).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@supabase/supabase-js') {
    return nextResolve(SUPABASE_FAKE_URL, context);
  }
  // 'next/server' bare (senza estensione) non è risolvibile dall'ESM
  // resolver di Node su un pacchetto CJS senza "exports" map — stesso
  // problema degli alias sotto, stesso fix mirato (solo su questo specifier
  // esatto, nessun altro sottopercorso di "next" viene toccato).
  if (specifier === 'next/server') {
    return nextResolve('next/server.js', context);
  }

  let result;
  if (specifier.startsWith('@/')) {
    const resolved = resolveAliasedPath(specifier.slice(2));
    // Nessun file trovato (es. un import type-only mai emesso a runtime, o
    // un percorso non previsto): lascia che nextResolve fallisca con
    // l'errore standard di Node, più chiaro di un errore custom qui.
    result = await nextResolve(resolved ? pathToFileURL(resolved).href : specifier, context);
  } else {
    result = await nextResolve(specifier, context);
  }

  // '@/src/lib/ai-router' è importato SIA con l'alias sopra SIA con
  // percorsi relativi da moduli nella stessa cartella (es.
  // '../ai-router.ts' da route-test-harness.ts) — invece di elencare ogni
  // forma possibile dello specifier, confrontiamo il risultato GIÀ
  // risolto: se punta esattamente al file reale di ai-router.ts, lo
  // sostituiamo col fake, qualunque sia stato lo specifier di partenza.
  //
  // ECCEZIONE necessaria: fake-ai-router-module.ts stesso fa
  // `export * from '../ai-router.ts'` per re-esportare le implementazioni
  // reali (extractJsonFromAiContent, AiRouterError, ecc.) — quell'IMPORT
  // SPECIFICO deve raggiungere il file VERO, altrimenti si crea un loop
  // (il fake che reindirizza a se stesso). Riconosciuto guardando
  // `context.parentURL`: solo quando il modulo che sta facendo l'import è
  // il fake stesso, lasciamo passare la risoluzione reale.
  if (result.url === AI_ROUTER_REAL_URL && context.parentURL !== AI_ROUTER_FAKE_URL) {
    return nextResolve(AI_ROUTER_FAKE_URL, context);
  }
  return result;
}
