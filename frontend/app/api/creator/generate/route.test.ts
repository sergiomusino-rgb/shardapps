// ─── Test HTTP — POST /api/creator/generate ─────────────────────────────────
// (CreatorAI Engine 2.0 — hardening post-DONE, blocco 1/2)
//
// Route REALE, entrambi i rami: quello con `projectType` (Fase 5, AI Agent
// Orchestrator -> generation_jobs) e quello storico sector-based (compat
// v1, invariato da questa fase — verifica di non-regressione). callAiRouter
// è mockata (coda di risposte in ordine: planner poi generator per il ramo
// orchestrator), tutto il resto — validator, sanitizeSiteBlueprint,
// fillBusinessConfigDefaults — resta il codice reale. Vedi
// src/lib/test-helpers/route-test-harness.ts.
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
};

const VALID_PLAN = { projectType: 'gestionale', sector: 'officina-meccanica', mainEntities: ['clienti'], pages: ['home'], workflows: [], keyFeatures: [] };

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
  return {
    defaultsByTable: { generation_jobs: GENERATION_JOBS_DEFAULTS, ...(extra.defaultsByTable || {}) },
    seedTables: {
      tenants: [{ id: 'tenant-1', owner_id: 'user-1', plan: 'pro', app_limit: 5, total_apps_created: 1 }],
      tenant_members: [{ id: 'tm-1', tenant_id: 'tenant-1', user_id: 'user-1', role: 'owner' }],
      ...(extra.seedTables || {}),
    },
    authUsers: { 'tok-1': { id: 'user-1', email: 'u@example.com' }, ...(extra.authUsers || {}) },
    ...extra,
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

test('generate -> job: prompt valido produce uno schema pronto e un generation_job status ready con piano+specification', async (t) => {
  const setup = setupRouteTest(t, baseSetup({
    aiResponses: [
      { content: JSON.stringify(VALID_PLAN) },           // 1a chiamata: Planner (app-planning)
      { content: JSON.stringify(validGestionaleRawSchema()) }, // 2a chiamata: Generator (app-generation)
    ],
  }));

  const res = await postGenerate({ projectType: 'gestionale', userPrompt: 'Gestionale per la mia officina meccanica', lang: 'it' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(body.data.schema);
  assert.equal(body.data.schema.adminPanel.entities[0].name, 'clienti');
  assert.ok(body.jobId);
  assert.equal(body.fallbackUsed, undefined);

  assert.equal(setup.aiCalls.length, 2);
  assert.equal(setup.aiCalls[0].task, 'app-planning');
  assert.equal(setup.aiCalls[1].task, 'app-generation');

  const job = await getGenerationJobForTenant(setup.supabase, body.jobId, 'tenant-1');
  assert.ok(job);
  assert.equal(job?.status, 'ready');
  assert.deepEqual(job?.plan, VALID_PLAN);
  assert.ok(job?.specification);
  assert.equal(job?.fallback_used, false);
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
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(setup.aiCalls.length, 3);
  assert.equal(setup.aiCalls[2].task, 'app-repair');

  const job = await getGenerationJobForTenant(setup.supabase, body.jobId, 'tenant-1');
  assert.equal(job?.status, 'ready');
  assert.equal(job?.retry_count, 1);
});

test('generate: fallback OBBLIGATORIO quando l\'orchestrator stesso fallisce (es. Generator irraggiungibile) -> fallbackUsed true, schema comunque restituito', async (t) => {
  const setup = setupRouteTest(t, baseSetup({
    aiResponses: [
      { content: JSON.stringify(VALID_PLAN) },        // planner ok
      new Error('OpenRouter non raggiungibile'),      // generator: fallisce -> orchestrator rilancia
      { content: JSON.stringify(validGestionaleRawSchema({ appName: 'Salvata dal fallback' })) }, // generatorFn richiamato DIRETTAMENTE dal fallback in route.ts
    ],
  }));

  const res = await postGenerate({ projectType: 'gestionale', userPrompt: 'Gestionale clienti', lang: 'it' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.fallbackUsed, true);
  assert.equal(body.data.schema.appName, 'Salvata dal fallback');
  assert.equal(setup.aiCalls.length, 3);

  // Il job creato dall'orchestrator prima del fallimento resta tracciato,
  // marcato failed+fallback_used (requisito Fase 5/6 "fallback esplicito e
  // registrato nel job") anche se la risposta HTTP finale è comunque un
  // successo (la strategia legacy ha salvato la richiesta dell'utente). La
  // risposta di fallback non espone il jobId dell'orchestrator (by design,
  // vedi route.ts) — interrogato qui direttamente sulla tabella in memoria.
  const { data: jobs } = await (setup.supabase.from('generation_jobs').select('*').eq('tenant_id', 'tenant-1') as unknown as Promise<{ data: Array<{ status: string; fallback_used: boolean }> }>);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, 'failed');
  assert.equal(jobs[0].fallback_used, true);
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
  assert.equal(resA.status, 200);

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
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(body.data.schema.schema.tables.length >= 1);
  // Il ramo legacy non crea alcun generation_job (comportamento invariato).
  assert.equal(body.jobId, undefined);
});
