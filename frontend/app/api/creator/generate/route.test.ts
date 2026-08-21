// ─── Test HTTP — POST /api/creator/generate ─────────────────────────────────
// (CreatorAI Engine 2.0 — hardening post-DONE, blocco 1/2; P0 fix "async
// generation / client-server lifecycle mismatch")
//
// Route REALE, entrambi i rami: quello con `projectType` (Fase 5, AI Agent
// Orchestrator -> generation_jobs, ORA ASINCRONO — P0-1) e quello storico
// sector-based (compat v1, invariato da questa fase — verifica di non-
// regressione). callAiRouter è mockata (coda di risposte in ordine: planner
// poi generator per il ramo orchestrator), tutto il resto — validator,
// sanitizeSiteBlueprint, fillBusinessConfigDefaults — resta il codice reale.
// Vedi src/lib/test-helpers/route-test-harness.ts.
//
// Nota sul contratto asincrono nei test: after() (next/server) lancia
// sincronamente fuori da uno scope di richiesta reale — questo harness
// chiama l'handler direttamente, senza passare dal dispatcher di Next.js,
// quindi non esiste quello scope. route.ts intercetta quel throw e ricade
// sull'esecuzione sincrona della pipeline PRIMA di rispondere (vedi
// commento in route.ts) — il job è quindi già nel suo stato finale quando
// POST risolve, ma la risposta HTTP riflette comunque solo lo SNAPSHOT
// iniziale del job (status 202, jobId, status:'planning'), per verificare
// il contratto reale usato dalla UI: il risultato va letto dal job
// (getGenerationJobForTenant), mai dal body della risposta immediata.
//
// Uso: node --experimental-test-module-mocks --test app/api/creator/generate/route.test.ts
// (dalla cartella frontend/).

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupRouteTest, importRoute, authHeaders } from '../../../../src/lib/test-helpers/route-test-harness.ts';
import { getGenerationJobForTenant } from '../../../../src/lib/creator-generation-jobs.ts';

const ROUTE_PATH = 'app/api/creator/generate/route.ts';
const GENERATION_JOBS_DEFAULTS = {
  app_id: null, created_by: null, plan: null, specification: null,
  artifacts: {}, error: null, retry_count: 0, fallback_used: false,
  result_schema: null, prompt_fingerprint: null,
};

// CreatorAI V3 (sezioni 10-11): relations/metrics/formulas esplicitati
// (invece di lasciarli al default Zod), così il confronto deepEqual sul job
// persistito resta la fonte di verità sull'intera forma del piano.
const VALID_PLAN = { projectType: 'gestionale', sector: 'officina-meccanica', mainEntities: ['clienti'], pages: ['home'], workflows: [], keyFeatures: [], relations: [], metrics: [], formulas: [] };

function validGestionaleRawSchema(overrides: Record<string, unknown> = {}) {
  return {
    projectType: 'gestionale',
    appName: 'Officina Generata',
    sector: 'officina-meccanica',
    description: '',
    businessConfig: { name: 'Officina Generata', language: 'it' },
    adminPanel: {
      entities: [
        {
          name: 'clienti', label: 'Cliente', labelPlural: 'Clienti', icon: '👤',
          fields: [{ id: 'id', type: 'id', label: 'ID' }, { id: 'nome', type: 'text', label: 'Nome', required: true }],
        },
      ],
    },
    pages: [{ slug: 'home', label: 'Home', sections: [] }],
    actionButtons: [],
    ui: { primaryColor: '#6366f1' },
    ...overrides,
  };
}

function baseSetup(extra: Parameters<typeof setupRouteTest>[1] = {}) {
  // NB: seedTables/authUsers/defaultsByTable sono già estratti e uniti
  // esplicitamente sotto — mai un ...extra finale che li sovrascriverebbe
  // interamente invece di unirsi (bug individuato durante l'implementazione
  // dei nuovi test di idempotenza: passare solo `seedTables.generation_jobs`
  // cancellava tenants/tenant_members di default invece di aggiungersi).
  const { seedTables: extraSeed, authUsers: extraAuth, defaultsByTable: extraDefaults, ...rest } = extra;
  return {
    defaultsByTable: { generation_jobs: GENERATION_JOBS_DEFAULTS, ...(extraDefaults || {}) },
    seedTables: {
      tenants: [{ id: 'tenant-1', owner_id: 'user-1', plan: 'pro', app_limit: 5, total_apps_created: 1 }],
      tenant_members: [{ id: 'tm-1', tenant_id: 'tenant-1', user_id: 'user-1', role: 'owner' }],
      ...(extraSeed || {}),
    },
    authUsers: { 'tok-1': { id: 'user-1', email: 'u@example.com' }, ...(extraAuth || {}) },
    ...rest,
  };
}

async function postGenerate(body: Record<string, unknown>, token = 'tok-1') {
  const { POST } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest('http://localhost/api/creator/generate', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  return (POST as (r: Request) => Promise<Response>)(req);
}

test('POST /api/creator/generate: 401 senza Authorization header', async (t) => {
  setupRouteTest(t, baseSetup());
  const { POST } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest('http://localhost/api/creator/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userPrompt: 'x', projectType: 'gestionale' }),
  });
  const res = await (POST as (r: Request) => Promise<Response>)(req);
  assert.equal(res.status, 401);
});

test('POST /api/creator/generate (ramo projectType): 400 se userPrompt manca', async (t) => {
  setupRouteTest(t, baseSetup());
  const res = await postGenerate({ projectType: 'gestionale', userPrompt: '' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'MISSING_INPUT');
});

test('generate -> job: 202 immediato con jobId, il job persistito raggiunge ready con piano+specification+result_schema', async (t) => {
  const setup = setupRouteTest(t, baseSetup({
    aiResponses: [
      { content: JSON.stringify(VALID_PLAN) },           // 1a chiamata: Planner (app-planning)
      { content: JSON.stringify(validGestionaleRawSchema()) }, // 2a chiamata: Generator (app-generation)
    ],
  }));

  const res = await postGenerate({ projectType: 'gestionale', userPrompt: 'Gestionale per la mia officina meccanica', lang: 'it' });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(body.jobId);
  assert.equal(body.data, undefined, 'la risposta immediata non contiene più lo schema (P0-1, async)');

  assert.equal(setup.aiCalls.length, 2);
  assert.equal(setup.aiCalls[0].task, 'app-planning');
  assert.equal(setup.aiCalls[1].task, 'app-generation');
  // FIX 1 (P0 Generation Reliability): il Generator ora richiede jsonMode
  // al provider, stesso trattamento già riservato al Planner — root-cause
  // dimostrata live: senza, il provider a volte rispondeva con content
  // vuoto/zero token, mai un errore HTTP, quindi mai ritentato.
  assert.equal(setup.aiCalls[1].jsonMode, true);

  const job = await getGenerationJobForTenant(setup.supabase, body.jobId, 'tenant-1');
  assert.ok(job);
  assert.equal(job?.status, 'ready');
  assert.deepEqual(job?.plan, VALID_PLAN);
  assert.ok(job?.specification);
  assert.ok(job?.result_schema);
  assert.equal((job?.result_schema as { adminPanel: { entities: Array<{ name: string }> } }).adminPanel.entities[0].name, 'clienti');
  assert.equal(job?.fallback_used, false);
  assert.ok(job?.prompt_fingerprint, 'il fingerprint va sempre calcolato/persistito (P0-2)');
});

test('generate: validazione fallita -> repair -> successo (retry_count 1, comunque status ready)', async (t) => {
  const invalidRaw = {
    projectType: 'webapp-pwa',
    appName: 'Sito Rotto',
    sector: 'servizi',
    description: '',
    businessConfig: { name: 'Sito Rotto', language: 'it' },
    adminPanel: { entities: [] },
    pages: [{ slug: 'home', label: 'Home', sections: [{ type: 'list', title: 'Catalogo', entity: 'entita_inesistente', layout: 'grid' }] }],
    actionButtons: [],
    ui: { primaryColor: '#6366f1' },
  };
  const fixedRaw = { ...invalidRaw, pages: [{ slug: 'home', label: 'Home', sections: [] }] };
  const setup = setupRouteTest(t, baseSetup({
    aiResponses: [
      { content: JSON.stringify({ ...VALID_PLAN, projectType: 'webapp-pwa' }) }, // planner
      { content: JSON.stringify(invalidRaw) },  // generator: produce uno schema semanticamente invalido
      { content: JSON.stringify(fixedRaw) },    // repair: lo corregge
    ],
  }));

  const res = await postGenerate({ projectType: 'webapp-pwa', userPrompt: 'Sito per un negozio', lang: 'it' });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(setup.aiCalls.length, 3);
  assert.equal(setup.aiCalls[2].task, 'app-repair');

  const job = await getGenerationJobForTenant(setup.supabase, body.jobId, 'tenant-1');
  assert.equal(job?.status, 'ready');
  assert.equal(job?.retry_count, 1);
  assert.ok(job?.result_schema);
});

test('generate: fallback OBBLIGATORIO quando l\'orchestrator stesso fallisce (es. Generator irraggiungibile) -> job comunque ready con fallback_used true (P0-1: mai una generazione riuscita invisibile al polling)', async (t) => {
  const setup = setupRouteTest(t, baseSetup({
    aiResponses: [
      { content: JSON.stringify(VALID_PLAN) },        // planner ok
      new Error('OpenRouter non raggiungibile'),      // generator: fallisce -> orchestrator rilancia
      { content: JSON.stringify(validGestionaleRawSchema({ appName: 'Salvata dal fallback' })) }, // generatorFn richiamato DIRETTAMENTE dal fallback in finalizeGenerationJob
    ],
  }));

  const res = await postGenerate({ projectType: 'gestionale', userPrompt: 'Gestionale clienti', lang: 'it' });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(body.jobId);
  assert.equal(setup.aiCalls.length, 3);

  // A differenza del comportamento sincrono di prima di P0-1 (dove la
  // risposta HTTP restituiva subito lo schema del fallback ma il job
  // restava marcato 'failed' per sempre, invisibile a chi avesse fatto
  // polling), il risultato del fallback-di-salvataggio viene ora persistito
  // sullo STESSO job.
  const job = await getGenerationJobForTenant(setup.supabase, body.jobId, 'tenant-1');
  assert.ok(job);
  assert.equal(job?.status, 'ready');
  assert.equal(job?.fallback_used, true);
  assert.equal((job?.result_schema as { appName?: string } | null)?.appName, 'Salvata dal fallback');
});

// P0 Generation Reliability (fallback lifecycle — FIX 2): il caso
// complementare al test sopra. Se ANCHE il fallback fallisce, il job deve
// arrivare a status='failed' con l'errore REALE del fallback (non quello
// del primo tentativo, che resta in artifacts.generatorError) — mai
// bloccato indefinitamente su un intermedio.
test('generate: fallback fallisce a sua volta -> job status "failed" con l\'errore reale del fallback (mai bloccato su un intermedio)', async (t) => {
  const setup = setupRouteTest(t, baseSetup({
    aiResponses: [
      { content: JSON.stringify(VALID_PLAN) },            // planner ok
      new Error('OpenRouter non raggiungibile'),           // generator (pipeline principale): fallisce
      new Error('OpenRouter ancora non raggiungibile'),     // fallback: fallisce a sua volta
    ],
  }));

  const res = await postGenerate({ projectType: 'gestionale', userPrompt: 'Gestionale clienti', lang: 'it' });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.ok(body.jobId);
  assert.equal(setup.aiCalls.length, 3);

  const job = await getGenerationJobForTenant(setup.supabase, body.jobId, 'tenant-1');
  assert.ok(job);
  assert.equal(job?.status, 'failed');
  assert.equal(job?.fallback_used, true);
  assert.match(job?.error || '', /OpenRouter ancora non raggiungibile/);
  assert.equal(job?.result_schema, null);
});

test('generate (ramo projectType): 403 SlotsExhausted quando il tenant ha esaurito gli slot', async (t) => {
  setupRouteTest(t, baseSetup({
    seedTables: {
      tenants: [{ id: 'tenant-1', owner_id: 'user-1', plan: 'starter', app_limit: 0, total_apps_created: 0 }],
      tenant_members: [{ id: 'tm-1', tenant_id: 'tenant-1', user_id: 'user-1', role: 'owner' }],
    },
  }));
  const res = await postGenerate({ projectType: 'gestionale', userPrompt: 'Un gestionale qualsiasi' });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, 'SLOTS_EXHAUSTED');
});

test('generate (ramo projectType): tenant beta con app_limit 0 genera comunque (Private Beta, nessun checkout Stripe)', async (t) => {
  const setup = setupRouteTest(t, baseSetup({
    seedTables: {
      tenants: [{ id: 'tenant-1', owner_id: 'user-1', plan: 'free', app_limit: 0, total_apps_created: 0, beta_access: true }],
      tenant_members: [{ id: 'tm-1', tenant_id: 'tenant-1', user_id: 'user-1', role: 'owner' }],
    },
    aiResponses: [
      { content: JSON.stringify(VALID_PLAN) },
      { content: JSON.stringify(validGestionaleRawSchema()) },
    ],
  }));
  const res = await postGenerate({ projectType: 'gestionale', userPrompt: 'Un gestionale qualsiasi' });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.success, true);
  const job = await getGenerationJobForTenant(setup.supabase, body.jobId, 'tenant-1');
  assert.equal(job?.status, 'ready');
});

test('tenant isolation: due tenant diversi ottengono job isolati, nessuna fuga cross-tenant', async (t) => {
  const setup = setupRouteTest(t, baseSetup({
    seedTables: {
      tenants: [
        { id: 'tenant-a', owner_id: 'user-a', plan: 'pro', app_limit: 5, total_apps_created: 0 },
        { id: 'tenant-b', owner_id: 'user-b', plan: 'pro', app_limit: 5, total_apps_created: 0 },
      ],
      tenant_members: [
        { id: 'tm-a', tenant_id: 'tenant-a', user_id: 'user-a', role: 'owner' },
        { id: 'tm-b', tenant_id: 'tenant-b', user_id: 'user-b', role: 'owner' },
      ],
    },
    authUsers: {
      'tok-a': { id: 'user-a', email: 'a@example.com' },
      'tok-b': { id: 'user-b', email: 'b@example.com' },
    },
    aiResponses: [
      { content: JSON.stringify(VALID_PLAN) },
      { content: JSON.stringify(validGestionaleRawSchema()) },
    ],
  }));

  const resA = await postGenerate({ projectType: 'gestionale', userPrompt: 'Gestionale A', lang: 'it' }, 'tok-a');
  const bodyA = await resA.json();
  assert.equal(resA.status, 202);

  // Il job del tenant A non è raggiungibile dal tenant B.
  const jobFromB = await getGenerationJobForTenant(setup.supabase, bodyA.jobId, 'tenant-b');
  assert.equal(jobFromB, null);
  const jobFromA = await getGenerationJobForTenant(setup.supabase, bodyA.jobId, 'tenant-a');
  assert.ok(jobFromA);
});

test('compat v1: ramo storico sector-based (senza projectType) continua a funzionare, nessuna regressione', async (t) => {
  setupRouteTest(t, baseSetup({
    aiResponses: [{
      content: JSON.stringify({
        appName: 'Pizzeria Legacy',
        description: 'Una pizzeria',
        sector: 'food',
        schema: { tables: [{ name: 'ordini', label: 'Ordine', labelPlural: 'Ordini', icon: '🍕', fields: [{ id: 'id', type: 'id', label: 'ID' }, { name: 'cliente', type: 'text', label: 'Cliente' }] }] },
      }),
    }],
  }));

  const res = await postGenerate({ userPrompt: 'Genera una pizzeria', sector: 'food' });
  assert.equal(res.status, 200, 'il ramo legacy resta SINCRONO, invariato — nessun P0-1 qui');
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(body.data.schema.schema.tables.length >= 1);
  // Il ramo legacy non crea alcun generation_job (comportamento invariato).
  assert.equal(body.jobId, undefined);
});

// ─── P0-2 (idempotenza) — TEST A/B/C/D del task ────────────────────────────

test('TEST A — stesso prompt + stesso tenant/utente mentre un job precedente è ancora "generating" -> stesso jobId, nessuna seconda chiamata AI', async (t) => {
  // Il fingerprint reale dipende da tenantId/userId/projectType/lang/prompt
  // normalizzato (creator-generation-jobs.ts) — lo calcoliamo con la stessa
  // funzione per non duplicarne la logica nel test, e lo pre-seediamo su un
  // job "in corso": simula esattamente lo scenario del task (client perde
  // la connessione, il server sta ancora lavorando, l'utente preme di nuovo
  // Genera) senza dover sincronizzare il timing reale di due richieste
  // concorrenti.
  const { computePromptFingerprint } = await import('../../../../src/lib/creator-generation-jobs.ts');
  const fp = computePromptFingerprint({ tenantId: 'tenant-1', createdBy: 'user-1', projectType: 'gestionale', lang: 'it', userPrompt: 'Gestionale per la mia officina meccanica' });

  const setup = setupRouteTest(t, baseSetup({
    seedTables: {
      tenants: [{ id: 'tenant-1', owner_id: 'user-1', plan: 'pro', app_limit: 5, total_apps_created: 0 }],
      tenant_members: [{ id: 'tm-1', tenant_id: 'tenant-1', user_id: 'user-1', role: 'owner' }],
      generation_jobs: [{
        id: 'job-in-progress', tenant_id: 'tenant-1', created_by: 'user-1', created_at: new Date().toISOString(),
        status: 'generating', current_step: 'generator', user_prompt: 'Gestionale per la mia officina meccanica',
        context: {}, plan: null, specification: null, artifacts: {}, error: null,
        retry_count: 0, fallback_used: false, result_schema: null,
        prompt_fingerprint: fp,
      }],
    },
  }));

  const res = await postGenerate({ projectType: 'gestionale', userPrompt: 'Gestionale per la mia officina meccanica', lang: 'it' });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.jobId, 'job-in-progress', 'deve riusare il job già in corso, non crearne uno nuovo');
  assert.equal(body.deduped, true);
  assert.equal(body.status, 'generating');
  assert.equal(setup.aiCalls.length, 0, 'nessuna chiamata AI: il job esistente non viene rielaborato');
});

test('TEST B — stesso prompt dopo che il job precedente è "ready" -> restituisce lo stesso risultato, non crea un secondo job/app', async (t) => {
  const { computePromptFingerprint } = await import('../../../../src/lib/creator-generation-jobs.ts');
  const fp = computePromptFingerprint({ tenantId: 'tenant-1', createdBy: 'user-1', projectType: 'gestionale', lang: 'it', userPrompt: 'Gestionale per la mia officina meccanica' });
  const readySchema = validGestionaleRawSchema({ appName: 'Officina Già Pronta' });

  const setup = setupRouteTest(t, baseSetup({
    seedTables: {
      tenants: [{ id: 'tenant-1', owner_id: 'user-1', plan: 'pro', app_limit: 5, total_apps_created: 1 }],
      tenant_members: [{ id: 'tm-1', tenant_id: 'tenant-1', user_id: 'user-1', role: 'owner' }],
      generation_jobs: [{
        id: 'job-ready', tenant_id: 'tenant-1', created_by: 'user-1', created_at: new Date().toISOString(),
        status: 'ready', current_step: 'ready', user_prompt: 'Gestionale per la mia officina meccanica',
        context: {}, plan: VALID_PLAN, specification: {}, artifacts: {}, error: null,
        retry_count: 0, fallback_used: false, result_schema: readySchema,
        prompt_fingerprint: fp,
      }],
    },
  }));

  const res = await postGenerate({ projectType: 'gestionale', userPrompt: 'Gestionale per la mia officina meccanica', lang: 'it' });
  assert.equal(res.status, 200, 'un job già pronto risponde subito, come il vecchio contratto sincrono');
  const body = await res.json();
  assert.equal(body.jobId, 'job-ready');
  assert.equal(body.deduped, true);
  assert.equal(body.data.schema.appName, 'Officina Già Pronta');
  assert.equal(setup.aiCalls.length, 0, 'nessuna nuova generazione: il risultato esistente viene riusato');

  const { data: jobs } = await (setup.supabase.from('generation_jobs').select('*').eq('tenant_id', 'tenant-1') as unknown as Promise<{ data: unknown[] }>);
  assert.equal(jobs.length, 1, 'nessun secondo job creato');
});

test('TEST C — job precedente "failed" -> NON viene riusato, una nuova generazione è consentita', async (t) => {
  const { computePromptFingerprint } = await import('../../../../src/lib/creator-generation-jobs.ts');
  const fp = computePromptFingerprint({ tenantId: 'tenant-1', createdBy: 'user-1', projectType: 'gestionale', lang: 'it', userPrompt: 'Gestionale per la mia officina meccanica' });

  const setup = setupRouteTest(t, baseSetup({
    seedTables: {
      tenants: [{ id: 'tenant-1', owner_id: 'user-1', plan: 'pro', app_limit: 5, total_apps_created: 0 }],
      tenant_members: [{ id: 'tm-1', tenant_id: 'tenant-1', user_id: 'user-1', role: 'owner' }],
      generation_jobs: [{
        id: 'job-failed', tenant_id: 'tenant-1', created_by: 'user-1', created_at: new Date().toISOString(),
        status: 'failed', current_step: 'failed', user_prompt: 'Gestionale per la mia officina meccanica',
        context: {}, plan: null, specification: null, artifacts: {}, error: 'errore precedente',
        retry_count: 2, fallback_used: true, result_schema: null,
        prompt_fingerprint: fp,
      }],
    },
    aiResponses: [
      { content: JSON.stringify(VALID_PLAN) },
      { content: JSON.stringify(validGestionaleRawSchema()) },
    ],
  }));

  const res = await postGenerate({ projectType: 'gestionale', userPrompt: 'Gestionale per la mia officina meccanica', lang: 'it' });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.notEqual(body.jobId, 'job-failed', 'un job fallito non viene mai riusato');
  assert.equal(body.deduped, undefined);
  assert.equal(setup.aiCalls.length, 2, 'la generazione riparte davvero, non viene bloccata dal job fallito precedente');

  const newJob = await getGenerationJobForTenant(setup.supabase, body.jobId, 'tenant-1');
  assert.equal(newJob?.status, 'ready');
});

test('TEST D — tenant A e tenant B con lo stesso identico prompt -> job diversi, nessuna collisione cross-tenant', async (t) => {
  const setup = setupRouteTest(t, baseSetup({
    seedTables: {
      tenants: [
        { id: 'tenant-a', owner_id: 'user-a', plan: 'pro', app_limit: 5, total_apps_created: 0 },
        { id: 'tenant-b', owner_id: 'user-b', plan: 'pro', app_limit: 5, total_apps_created: 0 },
      ],
      tenant_members: [
        { id: 'tm-a', tenant_id: 'tenant-a', user_id: 'user-a', role: 'owner' },
        { id: 'tm-b', tenant_id: 'tenant-b', user_id: 'user-b', role: 'owner' },
      ],
    },
    authUsers: {
      'tok-a': { id: 'user-a', email: 'a@example.com' },
      'tok-b': { id: 'user-b', email: 'b@example.com' },
    },
    aiResponses: [
      { content: JSON.stringify(VALID_PLAN) },
      { content: JSON.stringify(validGestionaleRawSchema()) },
      { content: JSON.stringify(VALID_PLAN) },
      { content: JSON.stringify(validGestionaleRawSchema()) },
    ],
  }));

  const SAME_PROMPT = 'Gestionale identico per due tenant diversi';
  const resA = await postGenerate({ projectType: 'gestionale', userPrompt: SAME_PROMPT, lang: 'it' }, 'tok-a');
  const bodyA = await resA.json();
  const resB = await postGenerate({ projectType: 'gestionale', userPrompt: SAME_PROMPT, lang: 'it' }, 'tok-b');
  const bodyB = await resB.json();

  assert.notEqual(bodyA.jobId, bodyB.jobId, 'stesso prompt, tenant diversi -> job diversi, mai un dato incrociato');
  assert.equal(setup.aiCalls.length, 4, 'entrambe le generazioni girano per davvero, nessuna "deduplicata" a torto tra tenant diversi');
});
