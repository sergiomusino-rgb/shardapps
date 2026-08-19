// ─── Test HTTP — GET /api/admin/beta-applications ──────────────────────────
// Stesso harness delle altre route (route-test-harness.ts): importa la route
// REALE con un fake Supabase in-memory al posto di '@supabase/supabase-js'.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupRouteTest, importRoute, authHeaders } from '../../../../src/lib/test-helpers/route-test-harness.ts';

const ROUTE_PATH = 'app/api/admin/beta-applications/route.ts';
const ADMIN_USER_ID = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';

function seedApplications() {
  return [
    { id: 'a1', full_name: 'Mario Rossi', company_name: 'Rossi Agency', email: 'mario@rossi.it', country: 'Italia', status: 'new', created_at: '2026-08-20T10:00:00.000Z' },
    { id: 'a2', full_name: 'Jane Doe', company_name: 'Doe Studio', email: 'jane@doe.com', country: 'UK', status: 'approved', created_at: '2026-08-21T10:00:00.000Z' },
  ];
}

async function callRoute(url: string, token?: string) {
  const { GET } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest(url, {
    method: 'GET',
    headers: token ? authHeaders(token) : undefined,
  });
  return (GET as (r: Request) => Promise<Response>)(req);
}

test('403: nessun header Authorization -> non autorizzato', async (t) => {
  setupRouteTest(t, { seedTables: { beta_applications: seedApplications() } });
  const res = await callRoute('http://localhost/api/admin/beta-applications');
  assert.equal(res.status, 403);
});

test('403: utente autenticato ma non admin (né ID hardcoded né profilo admin)', async (t) => {
  setupRouteTest(t, {
    seedTables: { beta_applications: seedApplications(), profiles: [{ user_id: 'user-1', role: 'user' }] },
    authUsers: { 'token-user': { id: 'user-1' } },
  });
  const res = await callRoute('http://localhost/api/admin/beta-applications', 'token-user');
  assert.equal(res.status, 403);
});

test('200: ADMIN_USER_ID hardcoded -> elenco completo, ordinato per data decrescente', async (t) => {
  setupRouteTest(t, {
    seedTables: { beta_applications: seedApplications() },
    authUsers: { 'token-admin': { id: ADMIN_USER_ID } },
  });
  const res = await callRoute('http://localhost/api/admin/beta-applications', 'token-admin');
  assert.equal(res.status, 200);
  const body = await res.json() as { applications: Array<{ id: string }> };
  assert.equal(body.applications.length, 2);
  assert.deepEqual(body.applications.map((a) => a.id), ['a2', 'a1'], 'più recente prima');
});

test('200: utente con profiles.role="admin" (non l\'ID hardcoded) è comunque autorizzato', async (t) => {
  setupRouteTest(t, {
    seedTables: { beta_applications: seedApplications(), profiles: [{ user_id: 'user-2', role: 'admin' }] },
    authUsers: { 'token-role-admin': { id: 'user-2' } },
  });
  const res = await callRoute('http://localhost/api/admin/beta-applications', 'token-role-admin');
  assert.equal(res.status, 200);
});

test('filtro status: ?status=approved restituisce solo le candidature con quello status', async (t) => {
  setupRouteTest(t, {
    seedTables: { beta_applications: seedApplications() },
    authUsers: { 'token-admin': { id: ADMIN_USER_ID } },
  });
  const res = await callRoute('http://localhost/api/admin/beta-applications?status=approved', 'token-admin');
  assert.equal(res.status, 200);
  const body = await res.json() as { applications: Array<{ id: string; status: string }> };
  assert.equal(body.applications.length, 1);
  assert.equal(body.applications[0].id, 'a2');
});

test('400: status filter non valido', async (t) => {
  setupRouteTest(t, {
    seedTables: { beta_applications: seedApplications() },
    authUsers: { 'token-admin': { id: ADMIN_USER_ID } },
  });
  const res = await callRoute('http://localhost/api/admin/beta-applications?status=not-a-real-status', 'token-admin');
  assert.equal(res.status, 400);
});
