// ─── Test HTTP — GET /api/admin/operations (Operations, Round 2) ───────────
// Stesso harness/pattern di app/api/admin/beta-applications/route.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupRouteTest, importRoute, authHeaders } from '../../../../src/lib/test-helpers/route-test-harness.ts';

const ROUTE_PATH = 'app/api/admin/operations/route.ts';
const ADMIN_USER_ID = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';

async function callRoute(token?: string) {
  const { GET } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest('http://localhost/api/admin/operations', {
    method: 'GET',
    headers: token ? authHeaders(token) : undefined,
  });
  return (GET as (r: Request) => Promise<Response>)(req);
}

test('403: nessun header Authorization -> non autorizzato', async (t) => {
  setupRouteTest(t, { seedTables: {} });
  const res = await callRoute();
  assert.equal(res.status, 403);
});

test('403: utente autenticato ma non admin', async (t) => {
  setupRouteTest(t, {
    seedTables: { profiles: [{ user_id: 'user-1', role: 'user' }] },
    authUsers: { 'token-user': { id: 'user-1' } },
  });
  const res = await callRoute('token-user');
  assert.equal(res.status, 403);
});

test('200: ADMIN_USER_ID hardcoded -> ultimo run per job, storico, consumo AI, alerting', async (t) => {
  setupRouteTest(t, {
    seedTables: {
      cron_job_runs: [
        { job_name: 'expiry-check', run_key: '2026-08-17', started_at: '2026-08-17T03:00:00.000Z', finished_at: '2026-08-17T03:00:05.000Z', status: 'ok', error: null },
        { job_name: 'expiry-check', run_key: '2026-08-18', started_at: '2026-08-18T03:00:00.000Z', finished_at: null, status: 'running', error: null },
        { job_name: 'workflow-tick', run_key: '2026-08-18T12:00', started_at: '2026-08-18T12:00:00.000Z', finished_at: '2026-08-18T12:00:01.000Z', status: 'failed', error: 'timeout' },
      ],
      ai_usage: [
        { cost_usd: 0.5, created_at: new Date().toISOString() },
        { cost_usd: 1.2, created_at: new Date().toISOString() },
      ],
    },
    authUsers: { 'token-admin': { id: ADMIN_USER_ID } },
  });
  const res = await callRoute('token-admin');
  assert.equal(res.status, 200);
  const body = await res.json() as {
    cronJobsMigrationApplied: boolean;
    jobs: { jobName: string; lastRun: { status: string; run_key: string } | null }[];
    recentRuns: unknown[];
    aiUsage: { migrationApplied: boolean; last24hCostUsd: number; last24hCalls: number };
    alerting: { emailConfigured: boolean; webhookConfigured: boolean };
  };

  assert.equal(body.cronJobsMigrationApplied, true);
  const expiryLast = body.jobs.find((j) => j.jobName === 'expiry-check')?.lastRun;
  // Il più recente dei due run 'expiry-check' (started_at 2026-08-18) — la
  // route ordina per started_at desc e prende il primo match per job.
  assert.equal(expiryLast?.run_key, '2026-08-18');
  const tickLast = body.jobs.find((j) => j.jobName === 'workflow-tick')?.lastRun;
  assert.equal(tickLast?.status, 'failed');
  assert.equal(body.recentRuns.length, 3);
  assert.equal(body.aiUsage.migrationApplied, true);
  assert.ok(Math.abs(body.aiUsage.last24hCostUsd - 1.7) < 1e-9);
  assert.equal(body.aiUsage.last24hCalls, 2);
});

test('200: nessun job mai eseguito -> lastRun null per ogni job noto (mai un\'eccezione)', async (t) => {
  setupRouteTest(t, {
    seedTables: { cron_job_runs: [], ai_usage: [] },
    authUsers: { 'token-admin': { id: ADMIN_USER_ID } },
  });
  const res = await callRoute('token-admin');
  assert.equal(res.status, 200);
  const body = await res.json() as { jobs: { lastRun: unknown }[] };
  assert.ok(body.jobs.every((j) => j.lastRun === null));
});
