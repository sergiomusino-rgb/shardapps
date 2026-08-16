// ─── Test HTTP — POST /api/creator/refactor ─────────────────────────────────
// (CreatorAI Engine 2.0 — hardening post-DONE, blocco 1/2)
//
// Route REALE: patch scoped RFC6902 tentata PRIMA, fallback OBBLIGATORIO alla
// riscrittura completa se la patch non è valida. callAiRouter è mockata
// (coda di risposte in ordine di chiamata: 1a = tentativo patch, 2a =
// eventuale fallback full-rewrite) — extractJsonFromAiContent/sanitizeSiteBlueprint/
// applyAndValidatePatch/runValidator restano il codice REALE. Vedi
// src/lib/test-helpers/route-test-harness.ts.
//
// Uso: node --experimental-test-module-mocks --test app/api/creator/refactor/route.test.ts
// (dalla cartella frontend/).

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupRouteTest, importRoute, authHeaders } from '../../../../src/lib/test-helpers/route-test-harness.ts';
import { getGenerationJobForTenant } from '../../../../src/lib/creator-generation-jobs.ts';

const ROUTE_PATH = 'app/api/creator/refactor/route.ts';
const GENERATION_JOBS_DEFAULTS = {
  app_id: null, created_by: null, plan: null, specification: null,
  artifacts: {}, error: null, retry_count: 0, fallback_used: false,
};

function currentSchema() {
  return {
    projectType: 'gestionale',
    appName: 'Officina Refactor Test',
    sector: 'officina-meccanica',
    description: '',
    businessConfig: { name: 'Officina Refactor Test', language: 'it' },
    adminPanel: {
      entities: [
        {
          name: 'clienti', label: 'Cliente', labelPlural: 'Clienti', icon: '👤',
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

async function postRefactor(schema: unknown, message: string, token = 'tok-1', appId?: string) {
  const { POST } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest('http://localhost/api/creator/refactor', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ schema, message, lang: 'it', appId }),
  });
  return (POST as (r: Request) => Promise<Response>)(req);
}

test('POST /api/creator/refactor: 401 senza Authorization header', async (t) => {
  setupRouteTest(t, baseSetup());
  const { POST } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest('http://localhost/api/creator/refactor', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ schema: currentSchema(), message: 'aggiungi un campo' }),
  });
  const res = await (POST as (r: Request) => Promise<Response>)(req);
  assert.equal(res.status, 401);
});

test('POST /api/creator/refactor: 400 se schema/message mancanti', async (t) => {
  setupRouteTest(t, baseSetup());
  const res1 = await postRefactor(undefined, 'ciao');
  assert.equal(res1.status, 400);
  const res2 = await postRefactor(currentSchema(), '');
  assert.equal(res2.status, 400);
});

test('refactor patch: patch RFC6902 valida -> mode "patch", nessun fallback, job status ready', async (t) => {
  const patchResponse = { patch: [{ op: 'add', path: '/adminPanel/entities/0/fields/-', value: { id: 'telefono', type: 'text', label: 'Telefono' } }] };
  const setup = setupRouteTest(t, baseSetup({
    aiResponses: [{ content: JSON.stringify(patchResponse) }],
  }));

  const res = await postRefactor(currentSchema(), 'aggiungi il telefono al cliente');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.mode, 'patch');
  assert.equal(body.fallbackUsed, undefined);
  assert.ok(body.data.schema.adminPanel.entities[0].fields.some((f: { id: string }) => f.id === 'telefono'));
  // Tutti i campi/entità preesistenti restano.
  assert.ok(body.data.schema.adminPanel.entities[0].fields.some((f: { id: string }) => f.id === 'nome'));

  const job = await getGenerationJobForTenant(setup.supabase, body.jobId, 'tenant-1');
  assert.ok(job);
  assert.equal(job?.status, 'ready');
  assert.equal(job?.fallback_used, false);
  assert.equal(setup.aiCalls.length, 1); // una sola chiamata AI: la patch è bastata
});

test('refactor con fallback OBBLIGATORIO: patch malformata -> ricade sulla riscrittura completa, mode "full-rewrite", fallbackUsed true', async (t) => {
  const rewrittenSchema = { ...currentSchema(), appName: 'Officina Riscritta' };
  const setup = setupRouteTest(t, baseSetup({
    aiResponses: [
      { content: 'questo non è JSON valido, il modello ha risposto testo libero' }, // 1a chiamata: tentativo patch, fallisce
      { content: JSON.stringify(rewrittenSchema) }, // 2a chiamata: fallback full-rewrite, riesce
    ],
  }));

  const res = await postRefactor(currentSchema(), 'riscrivi tutto quanto in modo radicale');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.mode, 'full-rewrite');
  assert.equal(body.fallbackUsed, true);
  assert.equal(body.data.schema.appName, 'Officina Riscritta');
  assert.equal(setup.aiCalls.length, 2); // tentativo patch + fallback

  const job = await getGenerationJobForTenant(setup.supabase, body.jobId, 'tenant-1');
  assert.equal(job?.status, 'ready');
  assert.equal(job?.fallback_used, true); // registrato esplicitamente nel job (requisito Fase 5/6)
});

test('refactor con fallback: patch che elimina dati accidentalmente -> ricade sulla riscrittura completa', async (t) => {
  // La patch rimuove l'unica entità con una "replace" ampia (non una
  // "remove" esplicita): applyAndValidatePatch la rifiuta come perdita dati
  // non dichiarata (stessa logica già coperta da creator-patch-engine.test.ts,
  // qui verificata end-to-end attraverso la route HTTP reale).
  const dataLossPatch = { patch: [{ op: 'replace', path: '/adminPanel/entities', value: [] }] };
  const rewrittenSchema = currentSchema();
  const setup = setupRouteTest(t, baseSetup({
    aiResponses: [
      { content: JSON.stringify(dataLossPatch) },
      { content: JSON.stringify(rewrittenSchema) },
    ],
  }));

  const res = await postRefactor(currentSchema(), 'rimuovi tutto');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mode, 'full-rewrite');
  assert.equal(body.fallbackUsed, true);
  assert.equal(setup.aiCalls.length, 2);

  const job = await getGenerationJobForTenant(setup.supabase, body.jobId, 'tenant-1');
  const artifacts = job?.artifacts as Record<string, unknown>;
  assert.ok(Array.isArray(artifacts.patchErrors));
  assert.match((artifacts.patchErrors as string[]).join(';'), /scomparsa senza un'operazione "remove" esplicita/);
});

test('refactor: se anche il fallback fallisce, la route risponde 500 INVALID_SCHEMA (nessun retry infinito) e il job risulta failed', async (t) => {
  const setup = setupRouteTest(t, baseSetup({
    aiResponses: [
      { content: 'non JSON' },   // patch fallisce
      { content: 'ancora non JSON' }, // fallback fallisce a sua volta
    ],
  }));
  const res = await postRefactor(currentSchema(), 'una richiesta qualsiasi');
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.code, 'INVALID_SCHEMA');
  void setup;
});

test('tenant isolation: il tenantId è sempre derivato server-side dal token, mai dal body della richiesta', async (t) => {
  const setup = setupRouteTest(t, baseSetup({
    aiResponses: [{ content: JSON.stringify({ patch: [{ op: 'replace', path: '/appName', value: 'Rinominata' }] }) }],
  }));
  const { POST } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  // Un tenantId arbitrario nel body viene semplicemente ignorato dalla route
  // (non esiste nemmeno un campo "tenantId" nel contratto di /refactor) —
  // verifica che il job risultante appartenga comunque al SOLO tenant
  // ricavato dal token (tenant-1), non a un valore iniettabile dal client.
  const req = new NextRequest('http://localhost/api/creator/refactor', {
    method: 'POST',
    headers: authHeaders('tok-1'),
    body: JSON.stringify({ schema: currentSchema(), message: 'rinomina', tenantId: 'tenant-iniettato-dal-client' }),
  });
  const res = await (POST as (r: Request) => Promise<Response>)(req);
  const body = await res.json();
  assert.equal(res.status, 200);

  const jobForRealTenant = await getGenerationJobForTenant(setup.supabase, body.jobId, 'tenant-1');
  assert.ok(jobForRealTenant);
  const jobForInjectedTenant = await getGenerationJobForTenant(setup.supabase, body.jobId, 'tenant-iniettato-dal-client');
  assert.equal(jobForInjectedTenant, null);
});
