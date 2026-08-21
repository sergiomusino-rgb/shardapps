// ─── Test isolati — CreatorAI Engine 2.0, Fase 5 (AI Agent Orchestrator) ────
// node:test nativo (Node 24), stesso stile delle altre suite Fase 0/1/5:
// nessuna chiamata di rete reale verso OpenRouter — planner/repair sono
// iniettati come fake `aiCall`/`plannerCall`/`repairCall` (stesso pattern già
// previsto dalla firma AiCallFn in creator-ai-orchestrator.ts proprio per
// questo), il Generator è iniettato come funzione pura (mai la vera
// callSiteSchemaGenerator, che chiamerebbe l'AI Router/OpenRouter). Il
// Supabase reale è sostituito dal fake in-memory (test-helpers/fake-supabase.ts).
//
// Copre i requisiti Fase 5, punto 12 "PLANNER" e "ORCHESTRATOR".
//
// Uso: node --test src/lib/creator-ai-orchestrator.test.ts (dalla cartella frontend/).

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeSupabase } from './test-helpers/fake-supabase.ts';
import { findForbiddenSecretKey, getGenerationJobForTenant } from './creator-generation-jobs.ts';
import {
  runPlanner,
  runValidator,
  runGenerationOrchestrator,
  PlannerError,
  MAX_REPAIR_RETRIES,
  classifyIssueCategory,
  evaluateGenerationAgainstPrompt,
  type AiCallFn,
  type ValidationIssue,
} from './creator-ai-orchestrator.ts';

const GENERATION_JOBS_DEFAULTS = {
  app_id: null,
  created_by: null,
  plan: null,
  specification: null,
  artifacts: {},
  error: null,
  retry_count: 0,
  fallback_used: false,
};

function freshSupabase() {
  return makeFakeSupabase({ generation_jobs: GENERATION_JOBS_DEFAULTS });
}

// Schema minimale valido (stessa forma di gestionaleFixture in
// site-schema.test.ts): passa sanitizeSiteBlueprint + AppSpecificationSchema
// senza errori semantici — usato come output "sano" del Generator fake.
function validRawSchema(overrides: Record<string, unknown> = {}) {
  return {
    projectType: 'gestionale',
    appName: 'Gestionale Test',
    sector: 'custom',
    description: '',
    businessConfig: { name: 'Gestionale Test', language: 'it' },
    adminPanel: {
      entities: [
        {
          name: 'clienti',
          label: 'Cliente',
          labelPlural: 'Clienti',
          icon: '👤',
          fields: [
            { id: 'id', type: 'id', label: 'ID' },
            { id: 'nome', type: 'text', label: 'Nome', required: true },
          ],
        },
      ],
    },
    pages: [{ slug: 'home', label: 'Home', sections: [] }],
    actionButtons: [],
    ui: { primaryColor: '#6366f1' },
    ...overrides,
  };
}

// Schema che fallisce SEMPRE runValidator: un campo "relation" che punta a
// un'entità inesistente sopravvive a sanitizeSiteBlueprint (degradato a
// 'text' per il campo, ma qui forziamo l'errore semantico esplicito con un
// riferimento rotto in una sezione "list", che runValidator verifica
// esplicitamente — vedi creator-ai-orchestrator.ts).
function invalidRawSchema() {
  return {
    projectType: 'webapp-pwa',
    appName: 'Sito Rotto',
    sector: 'custom',
    description: '',
    businessConfig: { name: 'Sito Rotto', language: 'it' },
    adminPanel: { entities: [] },
    pages: [{
      slug: 'home',
      label: 'Home',
      sections: [{ type: 'list', title: 'Catalogo', entity: 'entita_inesistente', layout: 'grid' }],
    }],
    actionButtons: [],
    ui: { primaryColor: '#6366f1' },
  };
}

function fakeAiCall(response: unknown): AiCallFn {
  return async () => ({ content: JSON.stringify(response) });
}

function throwingAiCall(message: string): AiCallFn {
  return async () => { throw new Error(message); };
}

function garbageAiCall(): AiCallFn {
  return async () => ({ content: 'questo non è JSON' });
}

const VALID_PLAN = {
  projectType: 'gestionale',
  sector: 'custom',
  mainEntities: ['clienti'],
  pages: ['home'],
  workflows: [],
  keyFeatures: ['gestione clienti'],
  // CreatorAI V3 (sezioni 10-11): campi opzionali aggiuntivi del piano,
  // esplicitati qui (invece di lasciarli al default Zod) così il confronto
  // deepEqual sotto resta la fonte di verità sull'intera forma del piano.
  relations: [],
  metrics: [],
  formulas: [],
};

// ═══════════════════════════════════════════════════════════════════════════
// PLANNER
// ═══════════════════════════════════════════════════════════════════════════

test('Planner: JSON valido -> GenerationPlan conforme allo schema minimo', async () => {
  const plan = await runPlanner(
    { userPrompt: 'Gestionale per una piccola officina', projectType: 'gestionale', lang: 'it' },
    fakeAiCall(VALID_PLAN)
  );
  assert.equal(plan.projectType, 'gestionale');
  assert.equal(plan.sector, 'custom');
  assert.deepEqual(plan.mainEntities, ['clienti']);
});

test('Planner: JSON invalido (non parsabile) -> PlannerError, mai un piano fabbricato in silenzio', async () => {
  await assert.rejects(
    () => runPlanner({ userPrompt: 'x', projectType: 'gestionale', lang: 'it' }, garbageAiCall()),
    PlannerError
  );
});

test('Planner: JSON valido ma non conforme allo schema minimo (campo obbligatorio mancante) -> PlannerError', async () => {
  // "sector" è obbligatorio (z.string(), nessun default) — vedi GenerationPlanSchema.
  await assert.rejects(
    () => runPlanner(
      { userPrompt: 'x', projectType: 'gestionale', lang: 'it' },
      fakeAiCall({ projectType: 'gestionale', mainEntities: [] })
    ),
    PlannerError
  );
});

test('Planner: campi opzionali assenti applicano i default ([]), non richiesti esplicitamente', async () => {
  const plan = await runPlanner(
    { userPrompt: 'x', projectType: 'landing', lang: 'it' },
    fakeAiCall({ projectType: 'landing', sector: 'artigianato' })
  );
  assert.deepEqual(plan.mainEntities, []);
  assert.deepEqual(plan.pages, []);
  assert.deepEqual(plan.workflows, []);
  assert.deepEqual(plan.keyFeatures, []);
});

// ═══════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR — planner -> generator -> validator (successo diretto)
// ═══════════════════════════════════════════════════════════════════════════

test('Orchestrator: planner -> generator -> validator, validazione riuscita al primo colpo -> status "ready"', async () => {
  const supabase = freshSupabase();
  let generateCalls = 0;

  const result = await runGenerationOrchestrator({
    supabase,
    tenantId: 'tenant-1',
    userId: 'user-1',
    userPrompt: 'Gestionale clienti per la mia officina',
    projectType: 'gestionale',
    lang: 'it',
    generate: async (promptWithContext) => {
      generateCalls += 1;
      // Il Generator riceve il contesto del piano anteposto al prompt utente.
      assert.match(promptWithContext, /Piano suggerito/);
      assert.match(promptWithContext, /Gestionale clienti per la mia officina/);
      return validRawSchema();
    },
    plannerCall: fakeAiCall(VALID_PLAN),
  });

  assert.equal(generateCalls, 1);
  assert.equal(result.status, 'ready');
  assert.equal(result.job.status, 'ready');
  assert.equal(result.job.retry_count, 0);
  assert.ok(result.specification);
  assert.ok(result.schema);
  // Il piano è stato persistito nel job.
  assert.deepEqual(result.job.plan, VALID_PLAN);
});

test('Orchestrator: validazione fallita -> repair -> successo al tentativo 1', async () => {
  const supabase = freshSupabase();
  let generateCalls = 0;

  const result = await runGenerationOrchestrator({
    supabase,
    tenantId: 'tenant-1',
    userId: 'user-1',
    userPrompt: 'Sito per un negozio',
    projectType: 'webapp-pwa',
    lang: 'it',
    generate: async () => { generateCalls += 1; return invalidRawSchema(); },
    plannerCall: fakeAiCall({ projectType: 'webapp-pwa', sector: 'retail' }),
    repairCall: fakeAiCall(validRawSchema({ projectType: 'webapp-pwa' })),
  });

  assert.equal(generateCalls, 1);
  assert.equal(result.status, 'ready');
  assert.equal(result.job.retry_count, 1);
  assert.ok(result.job.artifacts.validationErrors_attempt1);
});

test('Orchestrator: repair fallisce ripetutamente -> retry_count arriva a MAX_REPAIR_RETRIES -> status "failed"', async () => {
  const supabase = freshSupabase();

  const result = await runGenerationOrchestrator({
    supabase,
    tenantId: 'tenant-1',
    userId: 'user-1',
    userPrompt: 'Sito rotto',
    projectType: 'webapp-pwa',
    lang: 'it',
    generate: async () => invalidRawSchema(),
    plannerCall: fakeAiCall({ projectType: 'webapp-pwa', sector: 'retail' }),
    // Il Repair "corregge" restituendo di nuovo uno schema non valido: non
    // converge mai, deve esaurire i retry invece di ciclare all'infinito.
    repairCall: fakeAiCall(invalidRawSchema()),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.job.status, 'failed');
  assert.equal(result.job.retry_count, MAX_REPAIR_RETRIES);
  assert.equal(MAX_REPAIR_RETRIES, 2); // requisito esplicito Fase 5 punto 6
  assert.match(result.error!, /Validazione fallita dopo 2 tentativi di repair/);
});

test('Orchestrator: il Repair Agent stesso non produce JSON valido -> conta comunque come tentativo esaurito, nessun retry infinito', async () => {
  const supabase = freshSupabase();

  const result = await runGenerationOrchestrator({
    supabase,
    tenantId: 'tenant-1',
    userId: 'user-1',
    userPrompt: 'Sito rotto',
    projectType: 'webapp-pwa',
    lang: 'it',
    generate: async () => invalidRawSchema(),
    plannerCall: fakeAiCall({ projectType: 'webapp-pwa', sector: 'retail' }),
    repairCall: garbageAiCall(),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.job.retry_count, MAX_REPAIR_RETRIES);
  assert.ok(result.job.artifacts.repairError_attempt1);
  assert.ok(result.job.artifacts.repairError_attempt2);
});

// ═══════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR — Planner facoltativo/best-effort
// ═══════════════════════════════════════════════════════════════════════════

test('Orchestrator: skipPlanner=true salta completamente il Planner (facoltativo per il refactor)', async () => {
  const supabase = freshSupabase();
  let plannerCalled = false;

  const result = await runGenerationOrchestrator({
    supabase,
    tenantId: 'tenant-1',
    userId: 'user-1',
    userPrompt: 'Gestionale clienti',
    projectType: 'gestionale',
    lang: 'it',
    skipPlanner: true,
    generate: async (promptWithContext) => {
      // Nessun contesto di piano anteposto: il prompt utente arriva invariato.
      assert.equal(promptWithContext, 'Gestionale clienti');
      return validRawSchema();
    },
    plannerCall: async () => { plannerCalled = true; return { content: '{}' }; },
  });

  assert.equal(plannerCalled, false);
  assert.equal(result.status, 'ready');
  assert.equal(result.job.plan, null);
});

test('Orchestrator: un Planner che fallisce non blocca la generazione (best-effort, non bloccante)', async () => {
  const supabase = freshSupabase();

  const result = await runGenerationOrchestrator({
    supabase,
    tenantId: 'tenant-1',
    userId: 'user-1',
    userPrompt: 'Gestionale clienti',
    projectType: 'gestionale',
    lang: 'it',
    generate: async () => validRawSchema(),
    plannerCall: throwingAiCall('OpenRouter non raggiungibile'),
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.job.plan, null);
  assert.ok(result.job.artifacts.plannerError);
  assert.equal(result.job.current_step, 'ready');
});

// ═══════════════════════════════════════════════════════════════════════════
// FALLBACK (requisito Fase 5, punto 7): esplicito e registrato nel job
// ═══════════════════════════════════════════════════════════════════════════
//
// P0 Generation Reliability (root-cause dimostrata live — vedi report):
// il job NON viene più marcato 'failed' (terminale) qui — route.ts tenta
// SEMPRE un fallback subito dopo aver ricevuto l'errore rilanciato, e un
// client in polling smette di osservare il job non appena vede
// status='failed'. Se lo status fosse già 'failed' durante il tentativo di
// fallback, un fallback che POI riesce a produrre uno schema valido
// resterebbe invisibile al client — esattamente il bug dimostrato in
// produzione. Il job resta quindi 'generating' (stesso status non-terminale
// già usato per l'attesa del Generator principale, nessuna modifica lato
// client necessaria), con l'errore del tentativo fallito registrato in
// artifacts (stesso pattern di plannerError/repairError_attemptN sopra) —
// route.ts::finalizeGenerationJob decide poi lo stato REALMENTE terminale
// (ready o failed) in base all'esito del fallback (vedi generate/route.test.ts
// per quella parte, che vive fuori da questo modulo).
test('fallback: se il Generator iniettato fallisce, il job resta NON terminale (generating/fallback_in_progress) con l\'errore in artifacts, mai "failed" a questo punto', async () => {
  const supabase = freshSupabase();

  let thrown: (Error & { generationJobId?: string }) | undefined;
  try {
    await runGenerationOrchestrator({
      supabase,
      tenantId: 'tenant-1',
      userId: 'user-1',
      userPrompt: 'Gestionale clienti',
      projectType: 'gestionale',
      lang: 'it',
      generate: async () => { throw new Error('errore AI provider'); },
      plannerCall: fakeAiCall(VALID_PLAN),
    });
    assert.fail('runGenerationOrchestrator doveva rilanciare l\'errore originale');
  } catch (err) {
    thrown = err as Error & { generationJobId?: string };
  }

  // L'errore originale risale invariato (route.ts continua a poterlo
  // riconoscere con AiRouterError/AiRouterConfigError instanceof), solo
  // taggato con l'id del job per la tracciabilità.
  assert.match(thrown!.message, /errore AI provider/);
  assert.ok(thrown!.generationJobId);

  const job = await getGenerationJobForTenant(supabase, thrown!.generationJobId!, 'tenant-1');
  assert.ok(job);
  // NON terminale: un client in polling deve continuare a osservare questo
  // job mentre route.ts tenta il fallback, invece di fermarsi su un
  // "failed" prematuro.
  assert.equal(job?.status, 'generating');
  assert.equal(job?.current_step, 'fallback_in_progress');
  assert.equal(job?.fallback_used, true);
  // L'errore del tentativo fallito è tracciato per osservabilità, ma NON
  // nel campo top-level `error` (riservato allo stato realmente finale).
  assert.equal(job?.error, null);
  assert.equal(job?.artifacts.generatorError, 'errore AI provider');
});

// ═══════════════════════════════════════════════════════════════════════════
// SECURITY: nessun secret persistito nel job durante un run completo
// ═══════════════════════════════════════════════════════════════════════════

test('security: un run completo (planner + repair) non lascia mai chiavi sospette di segreto nel job persistito', async () => {
  const supabase = freshSupabase();

  const result = await runGenerationOrchestrator({
    supabase,
    tenantId: 'tenant-1',
    userId: 'user-1',
    userPrompt: 'Sito per un negozio',
    projectType: 'webapp-pwa',
    lang: 'it',
    generate: async () => invalidRawSchema(),
    plannerCall: fakeAiCall({ projectType: 'webapp-pwa', sector: 'retail' }),
    repairCall: fakeAiCall(validRawSchema({ projectType: 'webapp-pwa' })),
  });

  assert.equal(findForbiddenSecretKey(result.job.context), null);
  assert.equal(findForbiddenSecretKey(result.job.artifacts), null);
  assert.equal(findForbiddenSecretKey(result.job.plan), null);
});

// ═══════════════════════════════════════════════════════════════════════════
// CreatorAI v2 — VALIDATOR: errori strutturati (issues) + dashboardCards
// ═══════════════════════════════════════════════════════════════════════════

function schemaWithDashboardCard(card: Record<string, unknown>) {
  return validRawSchema({
    adminPanel: {
      entities: [
        {
          name: 'interventi',
          label: 'Intervento',
          labelPlural: 'Interventi',
          icon: '🔧',
          fields: [
            { id: 'id', type: 'id', label: 'ID' },
            { id: 'descrizione', type: 'text', label: 'Descrizione' },
            { id: 'costo_totale', type: 'number', label: 'Costo Totale' },
          ],
        },
      ],
    },
    dashboardCards: [card],
  });
}

test('runValidator: schema valido -> ok:true, issues assente/vuoto', () => {
  const result = runValidator(validRawSchema());
  assert.equal(result.ok, true);
  assert.ok(!result.issues || result.issues.length === 0);
});

test('runValidator: relation verso entità inesistente -> issue "error" con code dedicato, presente sia in errors che in issues', () => {
  const result = runValidator(invalidRawSchema());
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
  assert.ok(result.issues && result.issues.length > 0);
  assert.ok(result.issues!.every((i) => i.severity === 'error'));
  assert.ok(result.issues!.some((i) => i.code === 'SECTION_ENTITY_MISSING'));
});

test('runValidator: dashboardCard "sum" su un campo NON numerico -> issue "warning" DASHBOARD_FIELD_TYPE_MISMATCH, non blocca ok:true', () => {
  const schema = schemaWithDashboardCard({ type: 'sum', table: 'interventi', label: 'Descrizioni Totali', field: 'descrizione' });
  const result = runValidator(schema);
  // Warning, mai un errore: una dashboardCard scartata non ha mai impedito
  // la pubblicazione dell'app (comportamento pre-esistente di
  // resolveDashboardCards, invariato) — vedi commento in creator-ai-orchestrator.ts.
  assert.equal(result.ok, true);
  assert.ok(result.issues?.some((i) => i.code === 'DASHBOARD_FIELD_TYPE_MISMATCH' && i.severity === 'warning'));
});

test('runValidator: dashboardCard "sum" su un campo numerico REALE -> nessuna issue dashboardCards', () => {
  const schema = schemaWithDashboardCard({ type: 'sum', table: 'interventi', label: 'Costo Totale', field: 'costo_totale' });
  const result = runValidator(schema);
  assert.equal(result.ok, true);
  assert.ok(!result.issues?.some((i) => i.code.startsWith('DASHBOARD_')));
});

test('runValidator: dashboardCard con "table" inesistente -> issue "warning" DASHBOARD_CARD_TABLE_MISSING', () => {
  const schema = schemaWithDashboardCard({ type: 'count', table: 'tabella_mai_esistita', label: 'X' });
  const result = runValidator(schema);
  assert.equal(result.ok, true);
  assert.ok(result.issues?.some((i) => i.code === 'DASHBOARD_CARD_TABLE_MISSING' && i.severity === 'warning'));
});

// ═══════════════════════════════════════════════════════════════════════════
// CreatorAI v2 — ORCHESTRATOR: correzione deterministica pre-validazione
// (coerceObviousNumericFieldTypes) — nessuna chiamata AI, nessun ciclo di
// repair necessario per un caso "ovvio".
// ═══════════════════════════════════════════════════════════════════════════

test('Orchestrator: un campo "costo_totale" generato come "text" ma referenziato da una dashboardCard "sum" viene corretto in automatico PRIMA della validazione, zero repair', async () => {
  const supabase = freshSupabase();
  let repairCalled = false;

  const result = await runGenerationOrchestrator({
    supabase,
    tenantId: 'tenant-1',
    userId: 'user-1',
    userPrompt: 'Gestionale interventi con costo totale',
    projectType: 'gestionale',
    lang: 'it',
    skipPlanner: true,
    generate: async () => validRawSchema({
      adminPanel: {
        entities: [
          {
            name: 'interventi',
            label: 'Intervento',
            labelPlural: 'Interventi',
            icon: '🔧',
            fields: [
              { id: 'id', type: 'id', label: 'ID' },
              // Dichiarato "text" per errore del modello (esattamente il bug
              // osservato in produzione, Quality Pass v1.1 report F.1) — il
              // nome del campo suggerisce chiaramente una semantica monetaria.
              { id: 'costo_totale', type: 'text', label: 'Costo Totale' },
            ],
          },
        ],
      },
      dashboardCards: [{ type: 'sum', table: 'interventi', label: 'Costo Totale', field: 'costo_totale' }],
    }),
    repairCall: async () => { repairCalled = true; return { content: '{}' }; },
  });

  assert.equal(result.status, 'ready');
  assert.equal(repairCalled, false, 'la correzione deterministica non deve consumare un ciclo di repair via AI');
  assert.equal(result.job.retry_count, 0);
  // Il campo è stato corretto a "currency" (o "number"): la card sum sulla
  // sua esistenza numerica è quindi calcolabile — verificato leggendo lo
  // schema finale restituito.
  const entity = result.schema?.adminPanel.entities.find((e) => e.name === 'interventi');
  const field = entity?.fields.find((f) => f.id === 'costo_totale');
  assert.ok(field?.type === 'currency' || field?.type === 'number');
  assert.equal(result.schema?.dashboardCards.length, 1);
});

// ═══════════════════════════════════════════════════════════════════════════
// CREATORAI V3 — sezione 12: validazione estesa, displayField di una
// relation (fix TEST E, issue GitHub #39 punto 3 — riprodotto anche a
// livello di ORCHESTRATOR, non solo di rendering client, vedi
// table-definitions.test.ts).
// ═══════════════════════════════════════════════════════════════════════════

function schemaWithRelation(displayField: string) {
  return validRawSchema({
    adminPanel: {
      entities: [
        {
          name: 'member',
          label: 'Member',
          labelPlural: 'Members',
          icon: '🧑',
          fields: [
            { id: 'id', type: 'id', label: 'ID' },
            { id: 'full_name', type: 'text', label: 'Full Name' },
          ],
        },
        {
          name: 'subscription',
          label: 'Subscription',
          labelPlural: 'Subscriptions',
          icon: '📄',
          fields: [
            { id: 'id', type: 'id', label: 'ID' },
            { id: 'member_id', type: 'relation', label: 'Member', targetEntity: 'member', displayField },
          ],
        },
      ],
    },
  });
}

test('runValidator: relation con displayField che esiste davvero sull\'entità target -> nessuna issue RELATION_DISPLAY_FIELD_MISSING', () => {
  const result = runValidator(schemaWithRelation('full_name'));
  assert.equal(result.ok, true);
  assert.ok(!result.issues?.some((i) => i.code === 'RELATION_DISPLAY_FIELD_MISSING'));
});

test('runValidator: relation con displayField che NON esiste sull\'entità target -> issue "warning" RELATION_DISPLAY_FIELD_MISSING, non blocca ok:true', () => {
  const result = runValidator(schemaWithRelation('nome_che_non_esiste'));
  // Warning, mai un errore: il campo resta un id valido, solo l'etichetta
  // mostrata sarebbe sbagliata — mai un motivo per bloccare la generazione.
  assert.equal(result.ok, true);
  assert.ok(result.issues?.some((i) => i.code === 'RELATION_DISPLAY_FIELD_MISSING' && i.severity === 'warning'));
});

// ═══════════════════════════════════════════════════════════════════════════
// CREATORAI V3 — sezione 13: classifyIssueCategory.
// ═══════════════════════════════════════════════════════════════════════════

test('classifyIssueCategory: assegna la categoria attesa ai codici noti', () => {
  const cases: Array<[string, string]> = [
    ['SCHEMA_UNRECOVERABLE', 'structural'],
    ['SPEC_SCHEMA_INVALID', 'structural'],
    ['SECTION_ENTITY_MISSING', 'structural'],
    ['ACTION_TARGET_STATE_INVALID', 'semantic'],
    ['RELATION_TARGET_MISSING', 'relation'],
    ['RELATION_DISPLAY_FIELD_MISSING', 'relation'],
    ['WORKFLOW_TRIGGER_ENTITY_MISSING', 'relation'],
    ['WORKFLOW_ACTION_TARGET_MISSING', 'relation'],
    ['DASHBOARD_CARD_TABLE_MISSING', 'data'],
    ['DASHBOARD_FIELD_TYPE_MISMATCH', 'data'],
  ];
  for (const [code, expected] of cases) {
    const issue: ValidationIssue = { severity: 'error', code, path: '', message: '' };
    assert.equal(classifyIssueCategory(issue), expected, `code ${code} atteso "${expected}"`);
  }
});

test('classifyIssueCategory: un codice sconosciuto ricade sulla categoria più cautelativa ("structural")', () => {
  const issue: ValidationIssue = { severity: 'warning', code: 'CODICE_MAI_VISTO', path: '', message: '' };
  assert.equal(classifyIssueCategory(issue), 'structural');
});

// ═══════════════════════════════════════════════════════════════════════════
// CREATORAI V3 — sezione 14: Self-Evaluation.
// ═══════════════════════════════════════════════════════════════════════════

test('evaluateGenerationAgainstPrompt: relazioni richieste e presenti -> satisfied, score 1', () => {
  const spec = runValidator(schemaWithRelation('full_name')).specification!;
  const result = evaluateGenerationAgainstPrompt('Gestionale con abbonamenti collegati ai soci', spec);
  assert.ok(result.satisfied.some((s) => s.includes('relazioni')));
  assert.equal(result.missing.length, 0);
  assert.equal(result.score, 1);
});

test('evaluateGenerationAgainstPrompt: workflow/stati richiesti ma assenti dallo schema -> missing, score < 1', () => {
  const spec = runValidator(validRawSchema()).specification!; // nessun campo "state"
  const result = evaluateGenerationAgainstPrompt('Gestionale con flusso di lavoro e stati per ogni pratica', spec);
  assert.ok(result.missing.some((m) => m.includes('workflow')));
  assert.ok(result.score < 1);
});

test('evaluateGenerationAgainstPrompt: KPI/dashboard richiesti e presenti -> satisfied', () => {
  const schema = validRawSchema({ dashboardCards: [{ type: 'count', table: 'clienti', label: 'Totale Clienti' }] });
  const spec = runValidator(schema).specification!;
  const result = evaluateGenerationAgainstPrompt('Gestionale con dashboard e KPI principali', spec);
  assert.ok(result.satisfied.some((s) => s.includes('KPI')));
});

test('evaluateGenerationAgainstPrompt: un prompt senza alcun segnale verificabile -> score 1, nessun missing (mai un giudizio speculativo)', () => {
  const spec = runValidator(validRawSchema()).specification!;
  const result = evaluateGenerationAgainstPrompt('Un semplice sito vetrina per il mio negozio', spec);
  assert.equal(result.missing.length, 0);
  assert.equal(result.score, 1);
});

test('evaluateGenerationAgainstPrompt: formula richiesta ma non verificabile -> SOLO warning, mai "missing" (nessuna invenzione/blocco per interpretazioni speculative)', () => {
  const spec = runValidator(validRawSchema()).specification!; // un solo campo "text", nessun campo numerico
  // "subtotale" (non "totale" da solo): evita di far scattare anche
  // KPI_HINTS (che riconosce "totale" come possibile richiesta di KPI) —
  // qui si vuole isolare SOLO il segnale "formula".
  const result = evaluateGenerationAgainstPrompt('Calcola il subtotale moltiplicando quantità per prezzo unitario', spec);
  assert.equal(result.missing.length, 0);
  assert.ok(result.warnings.length > 0);
});

test('evaluateGenerationAgainstPrompt: nessuna entità generata -> sempre "missing", indipendentemente dal prompt', () => {
  const result = evaluateGenerationAgainstPrompt('qualunque richiesta', { entities: [] } as unknown as Parameters<typeof evaluateGenerationAgainstPrompt>[1]);
  assert.ok(result.missing.some((m) => m.includes('nessuna entità')));
});

test('Orchestrator: la self-evaluation viene persistita in artifacts dopo una generazione riuscita, mai bloccante', async () => {
  const supabase = freshSupabase();
  const result = await runGenerationOrchestrator({
    supabase,
    tenantId: 'tenant-1',
    userId: 'user-1',
    userPrompt: 'Gestionale con soci collegati agli abbonamenti',
    projectType: 'gestionale',
    lang: 'it',
    generate: async () => schemaWithRelation('full_name'),
    skipPlanner: true,
  });
  assert.equal(result.status, 'ready');
  assert.ok(result.job.artifacts?.selfEvaluation);
  const evalResult = result.job.artifacts!.selfEvaluation as { score: number; satisfied: string[] };
  assert.equal(evalResult.score, 1);
});
