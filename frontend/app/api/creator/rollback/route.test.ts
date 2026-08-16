// ─── Test HTTP — POST/GET /api/creator/rollback ─────────────────────────────
// (CreatorAI Engine 2.0 — hardening post-DONE, blocco 1/2)
//
// Esegue la route REALE (route.ts in questa stessa cartella) con vere
// NextRequest, sostituendo solo Supabase (fake in-memory) — questa route non
// chiama mai l'AI Router, nessun mock necessario lì. Vedi
// src/lib/test-helpers/route-test-harness.ts per il "perché" dell'approccio.
//
// Uso: node --experimental-test-module-mocks --test app/api/creator/rollback/route.test.ts
// (dalla cartella frontend/).

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupRouteTest, importRoute, authHeaders } from '../../../../src/lib/test-helpers/route-test-harness.ts';

const ROUTE_PATH = 'app/api/creator/rollback/route.ts';
const APP_VERSIONS_DEFAULTS = { created_by: null, generation_job_id: null };

function seedTenantWithApp(tenantId: string, userId: string, token: string, appId: string, config: unknown) {
  return {
    defaultsByTable: { app_versions: APP_VERSIONS_DEFAULTS },
    seedTables: {
      tenants: [{ id: tenantId, owner_id: userId, plan: 'pro', app_limit: 5, total_apps_created: 1 }],
      tenant_members: [{ id: 'tm-1', tenant_id: tenantId, user_id: userId, role: 'owner' }],
      apps: [{ id: appId, tenant_id: tenantId, config }],
    },
    authUsers: { [token]: { id: userId, email: 'owner@example.com' } },
  };
}

test('POST /api/creator/rollback: 401 senza Authorization header', async (t) => {
  setupRouteTest(t, {});
  const { POST } = await importRoute(ROUTE_PATH);
  const req = new (await import('next/server.js')).NextRequest('http://localhost/api/creator/rollback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ appId: 'a', versionId: 'v' }),
  });
  const res = await (POST as (r: Request) => Promise<Response>)(req);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.code, 'UNAUTHORIZED');
});

test('POST /api/creator/rollback: 400 se manca appId/versionId', async (t) => {
  const setup = setupRouteTest(t, seedTenantWithApp('tenant-1', 'user-1', 'tok-1', 'app-1', { appName: 'X' }));
  const { POST } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest('http://localhost/api/creator/rollback', {
    method: 'POST',
    headers: authHeaders('tok-1'),
    body: JSON.stringify({}),
  });
  const res = await (POST as (r: Request) => Promise<Response>)(req);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'MISSING_INPUT');
  void setup;
});

test('rollback autorizzato: ripristina apps.config e crea una nuova versione (source rollback)', async (t) => {
  const tenantId = 'tenant-1', userId = 'user-1', token = 'tok-1', appId = 'app-1';
  const currentConfig = { appName: 'Corrente (v2)' };
  const setup = setupRouteTest(t, seedTenantWithApp(tenantId, userId, token, appId, currentConfig));
  // Seed di una versione precedente (v1) per questa stessa app/tenant.
  const { createAppVersion } = await import('../../../../src/lib/app-versions.ts');
  const v1 = await createAppVersion(setup.supabase, { appId, tenantId, config: { appName: 'Precedente (v1)' } });

  const { POST } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest('http://localhost/api/creator/rollback', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ appId, versionId: v1.id }),
  });
  const res = await (POST as (r: Request) => Promise<Response>)(req);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.deepEqual(body.data.config, { appName: 'Precedente (v1)' });

  const { data: appRow } = await (setup.supabase.from('apps').select('*').eq('id', appId) as unknown as Promise<{ data: Array<{ config: unknown }> }>);
  assert.deepEqual(appRow[0].config, { appName: 'Precedente (v1)' });
});

test('rollback: accesso negato cross-tenant (versione di un altro tenant -> 404, apps.config invariato)', async (t) => {
  const tenantId = 'tenant-owner', userId = 'user-owner', token = 'tok-owner', appId = 'app-1';
  const attackerToken = 'tok-attacker';
  const setup = setupRouteTest(t, {
    defaultsByTable: { app_versions: APP_VERSIONS_DEFAULTS },
    seedTables: {
      tenants: [
        { id: tenantId, owner_id: userId, plan: 'pro', app_limit: 5, total_apps_created: 1 },
        { id: 'tenant-attacker', owner_id: 'user-attacker', plan: 'pro', app_limit: 5, total_apps_created: 0 },
      ],
      tenant_members: [
        { id: 'tm-1', tenant_id: tenantId, user_id: userId, role: 'owner' },
        { id: 'tm-2', tenant_id: 'tenant-attacker', user_id: 'user-attacker', role: 'owner' },
      ],
      apps: [{ id: appId, tenant_id: tenantId, config: { appName: 'Non toccarmi' } }],
    },
    authUsers: {
      [token]: { id: userId, email: 'owner@example.com' },
      [attackerToken]: { id: 'user-attacker', email: 'attacker@example.com' },
    },
  });
  const { createAppVersion } = await import('../../../../src/lib/app-versions.ts');
  const victimVersion = await createAppVersion(setup.supabase, { appId, tenantId, config: { appName: 'Segreta' } });

  const { POST } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest('http://localhost/api/creator/rollback', {
    method: 'POST',
    headers: authHeaders(attackerToken),
    body: JSON.stringify({ appId, versionId: victimVersion.id }),
  });
  const res = await (POST as (r: Request) => Promise<Response>)(req);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.code, 'VERSION_NOT_FOUND');

  const { data: appRow } = await (setup.supabase.from('apps').select('*').eq('id', appId) as unknown as Promise<{ data: Array<{ config: unknown }> }>);
  assert.deepEqual(appRow[0].config, { appName: 'Non toccarmi' }); // invariato
});

test('GET /api/creator/rollback?appId=...: lista le versioni del tenant proprietario', async (t) => {
  const tenantId = 'tenant-1', userId = 'user-1', token = 'tok-1', appId = 'app-1';
  const setup = setupRouteTest(t, seedTenantWithApp(tenantId, userId, token, appId, { appName: 'Corrente' }));
  const { createAppVersion } = await import('../../../../src/lib/app-versions.ts');
  await createAppVersion(setup.supabase, { appId, tenantId, config: { appName: 'v1' } });

  const { GET } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest(`http://localhost/api/creator/rollback?appId=${appId}`, {
    method: 'GET',
    headers: authHeaders(token),
  });
  const res = await (GET as (r: Request) => Promise<Response>)(req);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.versions.length, 1);
});
