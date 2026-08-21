// ─── Test HTTP — GET /api/creator/generate/status/[jobId] (P0-1, async
// generation) ────────────────────────────────────────────────────────────
// La UI (dashboard/creator/page.tsx) fa polling qui finché lo status non è
// terminale ('ready'/'failed') — vedi root-cause report "async generation /
// client-server lifecycle mismatch". TEST H/I del task: un job terminale
// deve essere riconoscibile in modo stabile dal contratto della risposta
// (è la UI, non testabile qui senza jsdom, a interrompere il polling in
// base a questo — vedi report finale).

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupRouteTest, importRoute, authHeaders } from '../../../../../../src/lib/test-helpers/route-test-harness.ts';

const ROUTE_PATH = 'app/api/creator/generate/status/[jobId]/route.ts';

function baseSetup(extra: Parameters<typeof setupRouteTest>[1] = {}) {
  // NB: `seedTables`/`authUsers` sono già estratti e uniti esplicitamente
  // sotto — mai un ...extra finale che li sovrascriverebbe interamente
  // invece di unirsi (bug individuato durante l'implementazione: uno spread
  // finale con `extra.seedTables` presente cancellava tenants/tenant_members
  // di default anziché aggiungersi).
  const { seedTables: extraSeed, authUsers: extraAuth, ...rest } = extra;
  return {
    seedTables: {
      tenants: [{ id: 'tenant-1', owner_id: 'user-1', plan: 'pro', app_limit: 5, total_apps_created: 1 }],
      tenant_members: [{ id: 'tm-1', tenant_id: 'tenant-1', user_id: 'user-1', role: 'owner' }],
      ...(extraSeed || {}),
    },
    authUsers: { 'tok-1': { id: 'user-1', email: 'u@example.com' }, ...(extraAuth || {}) },
    ...rest,
  };
}

function baseJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1', tenant_id: 'tenant-1', created_by: 'user-1', app_id: null,
    status: 'generating', current_step: 'generator', user_prompt: 'x',
    context: {}, plan: null, specification: null, artifacts: {}, error: null,
    retry_count: 0, fallback_used: false, result_schema: null, prompt_fingerprint: 'fp-1',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    ...overrides,
  };
}

async function getStatus(jobId: string, token = 'tok-1') {
  const { GET } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest(`http://localhost/api/creator/generate/status/${jobId}`, {
    headers: authHeaders(token),
  });
  return (GET as (r: Request, ctx: { params: Promise<{ jobId: string }> }) => Promise<Response>)(
    req, { params: Promise.resolve({ jobId }) }
  );
}

test('401 senza Authorization header', async (t) => {
  setupRouteTest(t, baseSetup());
  const { GET } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest('http://localhost/api/creator/generate/status/job-1');
  const res = await (GET as (r: Request, ctx: { params: Promise<{ jobId: string }> }) => Promise<Response>)(
    req, { params: Promise.resolve({ jobId: 'job-1' }) }
  );
  assert.equal(res.status, 401);
});

test('404: job inesistente', async (t) => {
  setupRouteTest(t, baseSetup());
  const res = await getStatus('job-inesistente');
  assert.equal(res.status, 404);
});

test('404: job di un altro tenant (nessuna fuga cross-tenant)', async (t) => {
  setupRouteTest(t, baseSetup({
    seedTables: {
      tenants: [
        { id: 'tenant-1', owner_id: 'user-1', plan: 'pro', app_limit: 5, total_apps_created: 1 },
        { id: 'tenant-2', owner_id: 'user-2', plan: 'pro', app_limit: 5, total_apps_created: 0 },
      ],
      tenant_members: [
        { id: 'tm-1', tenant_id: 'tenant-1', user_id: 'user-1', role: 'owner' },
        { id: 'tm-2', tenant_id: 'tenant-2', user_id: 'user-2', role: 'owner' },
      ],
      generation_jobs: [baseJob({ tenant_id: 'tenant-2', created_by: 'user-2' })],
    },
  }));
  const res = await getStatus('job-1');
  assert.equal(res.status, 404, 'un job di un altro tenant deve rispondere come "non trovato", mai come 403 (nessuna conferma di esistenza)');
});

test('non terminale (generating): status/current_step presenti, nessun campo data (schema non ancora pronto)', async (t) => {
  setupRouteTest(t, baseSetup({
    seedTables: { generation_jobs: [baseJob({ status: 'generating', current_step: 'generator' })] },
  }));
  const res = await getStatus('job-1');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.status, 'generating');
  assert.equal(body.current_step, 'generator');
  assert.equal(body.data, undefined, 'mai uno schema parziale/inventato prima di ready');
  assert.equal(body.error, null, 'un job ancora in corso non è mai un errore');
});

// ─── TEST H del task: stato terminale 'ready' ──────────────────────────────
test('TEST H — status "ready": contratto stabile con data.schema, la UI può fermare il polling', async (t) => {
  const schema = { appName: 'App Pronta', adminPanel: { entities: [] } };
  setupRouteTest(t, baseSetup({
    seedTables: { generation_jobs: [baseJob({ status: 'ready', current_step: 'ready', result_schema: schema })] },
  }));
  const res = await getStatus('job-1');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ready');
  assert.deepEqual(body.data.schema, schema);
  assert.equal(body.error, null);
});

// ─── TEST I del task: stato terminale 'failed' ─────────────────────────────
test('TEST I — status "failed": contratto stabile con error, la UI può fermare il polling senza inventare uno schema', async (t) => {
  setupRouteTest(t, baseSetup({
    seedTables: { generation_jobs: [baseJob({ status: 'failed', current_step: 'failed', error: 'Il provider AI non è raggiungibile' })] },
  }));
  const res = await getStatus('job-1');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'failed');
  assert.equal(body.error, 'Il provider AI non è raggiungibile');
  assert.equal(body.data, undefined);
});

test('P0-3: job non terminale "stantio" (nessun aggiornamento da oltre la soglia) viene marcato failed automaticamente al polling, mai bloccato per sempre', async (t) => {
  const staleUpdatedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minuti fa
  const setup = setupRouteTest(t, baseSetup({
    seedTables: { generation_jobs: [baseJob({ status: 'generating', updated_at: staleUpdatedAt })] },
  }));
  const res = await getStatus('job-1');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'failed', 'un job fermo da troppo tempo non deve restare "generating" all\'infinito');
  assert.ok(body.error);

  const { data } = await (setup.supabase.from('generation_jobs').select('*').eq('id', 'job-1') as unknown as Promise<{ data: Array<{ status: string }> }>);
  assert.equal(data[0].status, 'failed', 'lo stato stantio è persistito, non solo restituito una volta');
});

test('job non terminale ma aggiornato di recente: NON viene marcato failed (nessun falso positivo)', async (t) => {
  setupRouteTest(t, baseSetup({
    seedTables: { generation_jobs: [baseJob({ status: 'generating', updated_at: new Date().toISOString() })] },
  }));
  const res = await getStatus('job-1');
  const body = await res.json();
  assert.equal(body.status, 'generating', 'un job aggiornato di recente resta in corso, mai un falso "stantio"');
});
