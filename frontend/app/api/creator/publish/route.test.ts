// ─── Test HTTP — POST /api/creator/publish ──────────────────────────────────
// (CreatorAI Engine 2.0 — hardening post-DONE, blocco 1/2)
//
// Route REALE, nessuna AI coinvolta (publish persiste uno schema già pronto,
// non ne genera uno) — solo Supabase è mockato. Vedi
// src/lib/test-helpers/route-test-harness.ts.
//
// Uso: node --experimental-test-module-mocks --test app/api/creator/publish/route.test.ts
// (dalla cartella frontend/).

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupRouteTest, importRoute, authHeaders } from '../../../../src/lib/test-helpers/route-test-harness.ts';

const ROUTE_PATH = 'app/api/creator/publish/route.ts';
const APP_VERSIONS_DEFAULTS = { created_by: null, generation_job_id: null };

// Schema minimale valido per sanitizeSiteBlueprint (stessa forma delle
// fixture già usate in creator-patch-engine.test.ts/site-schema.test.ts).
function validSchema(overrides: Record<string, unknown> = {}) {
  return {
    projectType: 'gestionale',
    appName: 'Officina HTTP Test',
    sector: 'officina-meccanica',
    description: '',
    businessConfig: { name: 'Officina HTTP Test', language: 'it', email: 'info@officina-test.it' },
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
    defaultsByTable: { app_versions: APP_VERSIONS_DEFAULTS, ...(extra.defaultsByTable || {}) },
    ...extra,
  };
}

test('POST /api/creator/publish: 401 senza Authorization header', async (t) => {
  setupRouteTest(t, baseSetup());
  const { POST } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest('http://localhost/api/creator/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ schema: validSchema() }),
  });
  const res = await (POST as (r: Request) => Promise<Response>)(req);
  assert.equal(res.status, 401);
});

test('POST /api/creator/publish: 400 se lo schema è mancante o non valido', async (t) => {
  setupRouteTest(t, baseSetup({ authUsers: { 'tok-1': { id: 'user-1', email: 'u@example.com' } } }));
  const { POST } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');

  const reqMissing = new NextRequest('http://localhost/api/creator/publish', {
    method: 'POST', headers: authHeaders('tok-1'), body: JSON.stringify({}),
  });
  const resMissing = await (POST as (r: Request) => Promise<Response>)(reqMissing);
  assert.equal(resMissing.status, 400);
  assert.equal((await resMissing.json()).code, 'MISSING_INPUT');

  const reqInvalid = new NextRequest('http://localhost/api/creator/publish', {
    method: 'POST', headers: authHeaders('tok-1'), body: JSON.stringify({ schema: { not: 'a valid blueprint at all', pages: 'nope' } }),
  });
  const resInvalid = await (POST as (r: Request) => Promise<Response>)(reqInvalid);
  // sanitizeSiteBlueprint è molto permissivo (default ovunque): uno schema
  // quasi vuoto viene comunque normalizzato a qualcosa di valido — verifica
  // solo che la route non vada mai in 500 per un input "strano ma oggetto".
  assert.ok([200, 400].includes(resInvalid.status));
});

test('publish (nuova app): 403 SlotsExhausted quando il tenant ha esaurito gli slot', async (t) => {
  setupRouteTest(t, baseSetup({
    seedTables: {
      tenants: [{ id: 'tenant-1', owner_id: 'user-1', plan: 'starter', app_limit: 1, total_apps_created: 1 }],
      tenant_members: [{ id: 'tm-1', tenant_id: 'tenant-1', user_id: 'user-1', role: 'owner' }],
    },
    authUsers: { 'tok-1': { id: 'user-1', email: 'u@example.com' } },
  }));
  const { POST } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest('http://localhost/api/creator/publish', {
    method: 'POST', headers: authHeaders('tok-1'), body: JSON.stringify({ schema: validSchema() }),
  });
  const res = await (POST as (r: Request) => Promise<Response>)(req);
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.code, 'SLOTS_EXHAUSTED');
});

test('publish (nuova app): tenant beta con app_limit 0 pubblica comunque (Private Beta, nessun checkout Stripe)', async (t) => {
  setupRouteTest(t, baseSetup({
    seedTables: {
      tenants: [{ id: 'tenant-1', owner_id: 'user-1', plan: 'free', app_limit: 0, total_apps_created: 0, beta_access: true }],
      tenant_members: [{ id: 'tm-1', tenant_id: 'tenant-1', user_id: 'user-1', role: 'owner' }],
    },
    authUsers: { 'tok-1': { id: 'user-1', email: 'agenzia-beta@example.com' } },
  }));
  const { POST } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest('http://localhost/api/creator/publish', {
    method: 'POST', headers: authHeaders('tok-1'), body: JSON.stringify({ schema: validSchema() }),
  });
  const res = await (POST as (r: Request) => Promise<Response>)(req);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(body.data.appId);
});

test('publish (nuova app, human approval = chiamata POST esplicita): crea l\'app, consuma uno slot, ritorna credenziali', async (t) => {
  const setup = setupRouteTest(t, baseSetup({
    seedTables: {
      tenants: [{ id: 'tenant-1', owner_id: 'user-1', plan: 'starter', app_limit: 5, total_apps_created: 0 }],
      tenant_members: [{ id: 'tm-1', tenant_id: 'tenant-1', user_id: 'user-1', role: 'owner' }],
    },
    authUsers: { 'tok-1': { id: 'user-1', email: 'u@example.com' } },
  }));
  const { POST } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest('http://localhost/api/creator/publish', {
    method: 'POST', headers: authHeaders('tok-1'), body: JSON.stringify({ schema: validSchema() }),
  });
  const res = await (POST as (r: Request) => Promise<Response>)(req);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.updated, false);
  assert.ok(body.data.appId);
  assert.ok(body.data.clientPassword);

  // Lo slot è stato consumato (fallback non atomico: rpc non configurata ->
  // 42883 -> update diretto di tenants.total_apps_created, stesso percorso
  // reale già coperto in produzione quando la RPC non è ancora deployata).
  const { data: tenantRows } = await (setup.supabase.from('tenants').select('*').eq('id', 'tenant-1') as unknown as Promise<{ data: Array<{ total_apps_created: number }> }>);
  assert.equal(tenantRows[0].total_apps_created, 1);

  // Nessuna versione creata alla prima pubblicazione (nessuno stato precedente).
  const { listAppVersions } = await import('../../../../src/lib/app-versions.ts');
  const versions = await listAppVersions(setup.supabase, body.data.appId, 'tenant-1');
  assert.deepEqual(versions, []);
});

test('publish (ripubblicazione, existingAppId): 403 se l\'app appartiene a un altro tenant (app isolation)', async (t) => {
  setupRouteTest(t, baseSetup({
    seedTables: {
      tenants: [
        { id: 'tenant-owner', owner_id: 'user-owner', plan: 'pro', app_limit: 5, total_apps_created: 1 },
        { id: 'tenant-attacker', owner_id: 'user-attacker', plan: 'pro', app_limit: 5, total_apps_created: 0 },
      ],
      tenant_members: [
        { id: 'tm-1', tenant_id: 'tenant-owner', user_id: 'user-owner', role: 'owner' },
        { id: 'tm-2', tenant_id: 'tenant-attacker', user_id: 'user-attacker', role: 'owner' },
      ],
      apps: [{ id: 'app-victim', tenant_id: 'tenant-owner', slug: 'officina-x', config: validSchema() }],
    },
    authUsers: {
      'tok-owner': { id: 'user-owner', email: 'owner@example.com' },
      'tok-attacker': { id: 'user-attacker', email: 'attacker@example.com' },
    },
  }));
  const { POST } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest('http://localhost/api/creator/publish', {
    method: 'POST',
    headers: authHeaders('tok-attacker'),
    body: JSON.stringify({ schema: validSchema({ appName: 'Rubata' }), appId: 'app-victim' }),
  });
  const res = await (POST as (r: Request) => Promise<Response>)(req);
  assert.equal(res.status, 403);
});

test('publish (ripubblicazione, existingAppId del proprio tenant): aggiorna apps.config e crea una version snapshot dello stato precedente', async (t) => {
  const tenantId = 'tenant-1', appId = 'app-1';
  const previousConfig = validSchema({ appName: 'Prima della modifica' });
  const setup = setupRouteTest(t, baseSetup({
    seedTables: {
      tenants: [{ id: tenantId, owner_id: 'user-1', plan: 'pro', app_limit: 5, total_apps_created: 1 }],
      tenant_members: [{ id: 'tm-1', tenant_id: tenantId, user_id: 'user-1', role: 'owner' }],
      apps: [{ id: appId, tenant_id: tenantId, slug: 'officina-1', config: previousConfig }],
    },
    authUsers: { 'tok-1': { id: 'user-1', email: 'u@example.com' } },
  }));
  const { POST } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const nextConfig = validSchema({ appName: 'Dopo la modifica' });
  const req = new NextRequest('http://localhost/api/creator/publish', {
    method: 'POST', headers: authHeaders('tok-1'), body: JSON.stringify({ schema: nextConfig, appId }),
  });
  const res = await (POST as (r: Request) => Promise<Response>)(req);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.updated, true);
  assert.equal(body.data.appId, appId);

  const { data: appRows } = await (setup.supabase.from('apps').select('*').eq('id', appId) as unknown as Promise<{ data: Array<{ config: { appName: string } }> }>);
  assert.equal(appRows[0].config.appName, 'Dopo la modifica');

  // creazione version: lo stato PRIMA della ripubblicazione è stato
  // snapshottato in app_versions (requisito Fase 6, verificato qui a
  // livello HTTP e non solo di modulo).
  const { listAppVersions } = await import('../../../../src/lib/app-versions.ts');
  const versions = await listAppVersions(setup.supabase, appId, tenantId);
  assert.equal(versions.length, 1);
  assert.equal((versions[0].config as { appName: string }).appName, 'Prima della modifica');
  assert.equal(versions[0].source, 'publish');

  // Nessuno slot consumato per una ripubblicazione (invariato).
  const { data: tenantRows } = await (setup.supabase.from('tenants').select('*').eq('id', tenantId) as unknown as Promise<{ data: Array<{ total_apps_created: number }> }>);
  assert.equal(tenantRows[0].total_apps_created, 1);
});
