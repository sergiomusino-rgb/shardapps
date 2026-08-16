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

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const resolved = resolveAliasedPath(specifier.slice(2));
    if (resolved) {
      return nextResolve(pathToFileURL(resolved).href, context);
    }
    // Nessun file trovato (es. un import type-only mai emesso a runtime, o
    // un percorso non previsto): lascia che nextResolve fallisca con
    // l'errore standard di Node, più chiaro di un errore custom qui.
  }
  // 'next/server' bare (senza estensione) non è risolvibile dall'ESM
  // resolver di Node su un pacchetto CJS senza "exports" map — stesso
  // problema degli alias sopra, stesso fix mirato (solo su questo specifier
  // esatto, nessun altro sottopercorso di "next" viene toccato).
  if (specifier === 'next/server') {
    return nextResolve('next/server.js', context);
  }
  return nextResolve(specifier, context);
}
