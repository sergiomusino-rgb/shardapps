// ─── Test HTTP — POST /api/apps/decrement-fee ───────────────────────────────
// Security audit fix: prima dashboard/projects/[id]/page.tsx ('use client')
// leggeva process.env.BACKEND_SERVICE_TOKEN direttamente nel browser (sempre
// undefined, nessun prefisso NEXT_PUBLIC_) per chiamare il backend. Questa
// route sposta la chiamata lato server: qui si verifica che il tenant sia
// SEMPRE derivato dalla sessione autenticata (mai da un id fornito dal
// client) e che il token verso il backend non venga mai letto/eseguito nel
// browser (impossibile da testare direttamente qui — garantito dal fatto che
// questa è una route.ts, eseguita solo server-side da Next.js).
//
// Uso: node --test "app/api/apps/decrement-fee/route.test.ts" (da frontend/).

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupRouteTest, importRoute, authHeaders } from '../../../../src/lib/test-helpers/route-test-harness.ts';

const ROUTE_PATH = 'app/api/apps/decrement-fee/route.ts';

function seed() {
  return {
    seedTables: {
      tenant_members: [
        { id: 'tm-1', tenant_id: 'tenant-1', user_id: 'user-1', role: 'owner' },
      ],
    },
    authUsers: {
      'tok-user1': { id: 'user-1', email: 'user1@example.com' },
      'tok-orphan': { id: 'user-orphan', email: 'orphan@example.com' },
    },
  };
}

async function callRoute(token?: string) {
  const { POST } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest('http://localhost/api/apps/decrement-fee', {
    method: 'POST',
    headers: token ? authHeaders(token) : { 'content-type': 'application/json' },
  });
  return (POST as (r: Request) => Promise<Response>)(req);
}

test('401 senza Authorization header', async (t) => {
  setupRouteTest(t, seed());
  const res = await callRoute();
  assert.equal(res.status, 401);
});

test('401 con token non valido (nessun utente risolto)', async (t) => {
  setupRouteTest(t, seed());
  const res = await callRoute('tok-non-esistente');
  assert.equal(res.status, 401);
});

test('404 se l\'utente autenticato non ha un tenant', async (t) => {
  setupRouteTest(t, seed());
  const res = await callRoute('tok-orphan');
  assert.equal(res.status, 404);
});

test('200: chiama il backend con tenantId derivato dalla sessione (mai dal client) e action=decrement', async (t) => {
  setupRouteTest(t, seed());
  process.env.BACKEND_SERVICE_TOKEN = 'test-shared-secret';
  process.env.NEXT_PUBLIC_BACKEND_URL = 'https://backend.test';

  const calls: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const res = await callRoute('tok-user1');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://backend.test/api/update-app-fee');
  const sentHeaders = calls[0].init.headers as Record<string, string>;
  assert.equal(sentHeaders['Authorization'], 'Bearer test-shared-secret');
  const sentBody = JSON.parse(calls[0].init.body as string);
  assert.equal(sentBody.tenantId, 'tenant-1');
  assert.equal(sentBody.action, 'decrement');
});

test('502 se la chiamata al backend fallisce', async (t) => {
  setupRouteTest(t, seed());
  process.env.BACKEND_SERVICE_TOKEN = 'test-shared-secret';
  process.env.NEXT_PUBLIC_BACKEND_URL = 'https://backend.test';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('err', { status: 500 })) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const res = await callRoute('tok-user1');
  assert.equal(res.status, 502);
});
