// ─── Test isolati — Quality Pass v1.1, Fix #3 (dashboardCards: completezza KPI) ──
// node:test nativo. callSiteSchemaGenerator chiama l'AI reale (fuori scope
// per un test unitario deterministico) — qui si verifica solo che il testo
// del prompt realmente inviato al modello (DASHBOARD_CARDS_DOC, esportata
// per questo motivo) contenga la regola di completezza rinforzata: la parte
// effettivamente sotto controllo del codice, non il comportamento del
// modello (non testabile senza rete/costo).
//
// creator-site-generator.ts importa `@/lib/designSystemLoader` e
// `@/src/lib/ai-router` (alias di progetto, risolti da Next.js/webpack ma
// non da `node --test` diretto) — stesso loader di risoluzione alias già
// riusato da mockDataGenerator.test.ts (route-test-harness.ts).
//
// Uso: node --test src/lib/creator-site-generator.test.ts (dalla cartella frontend/).

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupRouteTest, importRoute } from './test-helpers/route-test-harness.ts';

setupRouteTest({} as unknown, {}); // registra il loader di risoluzione alias per questo processo
const { DASHBOARD_CARDS_DOC, WORKFLOW_DOC, ensureGestionaleHasPages } = (await importRoute('src/lib/creator-site-generator.ts')) as {
  DASHBOARD_CARDS_DOC: string;
  WORKFLOW_DOC: string;
  ensureGestionaleHasPages: (rawSchema: unknown, projectType: string) => unknown;
};

test('DASHBOARD_CARDS_DOC istruisce esplicitamente a non omettere una KPI richiesta dal prompt', () => {
  assert.match(DASHBOARD_CARDS_DOC, /non omettere una kpi esplicitamente richiesta/i);
  assert.match(DASHBOARD_CARDS_DOC, /ogni kpi o metrica esplicitamente richiesta/i);
});

test('DASHBOARD_CARDS_DOC ribadisce che la regola vale solo se il prompt richiede metriche esplicitamente (nessun obbligo generico)', () => {
  assert.match(DASHBOARD_CARDS_DOC, /solo quando il prompt richiede esplicitamente delle metriche/i);
});

test('DASHBOARD_CARDS_DOC conserva il vocabolario esistente (count/sum/avg/latest) — nessuna regressione sul contratto già documentato', () => {
  assert.match(DASHBOARD_CARDS_DOC, /"count"/);
  assert.match(DASHBOARD_CARDS_DOC, /"sum"/);
  assert.match(DASHBOARD_CARDS_DOC, /"avg"/);
  assert.match(DASHBOARD_CARDS_DOC, /"latest"/);
});

// ═══════════════════════════════════════════════════════════════════════════
// Regressione: ensureGestionaleHasPages (Fix #1, non toccato da questa
// sessione) deve restare invariato.
// ═══════════════════════════════════════════════════════════════════════════
test('ensureGestionaleHasPages: nessuna regressione, invariato da questa sessione', () => {
  const raw = { pages: [] };
  const result = ensureGestionaleHasPages(raw, 'gestionale') as { pages: unknown[] };
  assert.equal(result.pages.length, 1);
  assert.equal((result.pages[0] as { slug: string }).slug, 'home');
});

// ═══════════════════════════════════════════════════════════════════════════
// Regressione: trigger_webhook e send_notification sono implementati in runtime
// (vedi backend/lib/action-dispatcher.js) — il prompt non deve più indicarli
// come "non ancora implementati".
// ═══════════════════════════════════════════════════════════════════════════
test('WORKFLOW_DOC documenta correttamente che trigger_webhook e send_notification sono implementati', () => {
  // Verifica che il prompt NON dica che le azioni sono non implementate
  assert.doesNotMatch(WORKFLOW_DOC, /non è ancora implementata/);
  assert.doesNotMatch(WORKFLOW_DOC, /l'unico tipo con effetto reale oggi/);
  
  // Verifica che il prompt menzioni esplicitamente che sono implementate
  assert.match(WORKFLOW_DOC, /trigger_webhook/);
  assert.match(WORKFLOW_DOC, /send_notification/);
  assert.match(WORKFLOW_DOC, /tutti e tre i tipi sono eseguiti in produzione/);
});
