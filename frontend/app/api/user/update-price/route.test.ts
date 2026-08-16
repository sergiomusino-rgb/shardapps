// ─── Test HTTP — POST /api/user/update-price (vincolo prezzo minimo) ───────
// Pre-launch hardening: prima il vincolo di 25€ minimo sul prezzo cliente
// finale scattava lato server SOLO per tenant.plan === 'starter' — un
// reseller Pro o Business poteva impostare client_subscription_price sotto
// ZEUSX_MINIMUM_FEE_EUR senza alcun blocco. Il fix rimuove la dipendenza dal
// piano: qui si verifica che il minimo valga per Starter, Pro E Business.
//
// Uso: node --test "app/api/user/update-price/route.test.ts" (da frontend/).

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupRouteTest, importRoute, authHeaders } from '../../../../src/lib/test-helpers/route-test-harness.ts';

const ROUTE_PATH = 'app/api/user/update-price/route.ts';

function seed() {
  return {
    seedTables: {
      tenants: [
        { id: 'tenant-starter', owner_id: 'user-starter', plan: 'starter' },
        { id: 'tenant-pro', owner_id: 'user-pro', plan: 'pro' },
        { id: 'tenant-business', owner_id: 'user-business', plan: 'business' },
      ],
      tenant_members: [
        { id: 'tm-starter', tenant_id: 'tenant-starter', user_id: 'user-starter', role: 'owner' },
        { id: 'tm-pro', tenant_id: 'tenant-pro', user_id: 'user-pro', role: 'owner' },
        { id: 'tm-business', tenant_id: 'tenant-business', user_id: 'user-business', role: 'owner' },
      ],
      apps: [
        { id: 'app-starter', tenant_id: 'tenant-starter', name: 'App Starter', client_subscription_price: null, client_price: null },
        { id: 'app-pro', tenant_id: 'tenant-pro', name: 'App Pro', client_subscription_price: null, client_price: null },
        { id: 'app-business', tenant_id: 'tenant-business', name: 'App Business', client_subscription_price: null, client_price: null },
      ],
    },
    authUsers: {
      'tok-starter': { id: 'user-starter', email: 'starter@example.com' },
      'tok-pro': { id: 'user-pro', email: 'pro@example.com' },
      'tok-business': { id: 'user-business', email: 'business@example.com' },
    },
  };
}

async function updatePrice(appId: string, price: number, token: string) {
  const { POST } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest('http://localhost/api/user/update-price', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ app_id: appId, client_subscription_price: price }),
  });
  return (POST as (r: Request) => Promise<Response>)(req);
}

for (const [plan, appId, token] of [
  ['starter', 'app-starter', 'tok-starter'],
  ['pro', 'app-pro', 'tok-pro'],
  ['business', 'app-business', 'tok-business'],
] as const) {
  test(`piano ${plan}: prezzo sotto 25€ (24.99) viene rifiutato con 400, nessuna scrittura`, async (t) => {
    const setup = setupRouteTest(t, seed());
    const res = await updatePrice(appId, 24.99, token);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /25/);

    const { data: rows } = await (setup.supabase.from('apps').select('*').eq('id', appId) as unknown as Promise<{ data: Array<{ client_subscription_price: number | null }> }>);
    assert.equal(rows[0].client_subscription_price, null); // invariato
  });

  test(`piano ${plan}: prezzo esattamente 25€ viene accettato (200), persistito realmente`, async (t) => {
    const setup = setupRouteTest(t, seed());
    const res = await updatePrice(appId, 25, token);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.client_subscription_price, 25);

    const { data: rows } = await (setup.supabase.from('apps').select('*').eq('id', appId) as unknown as Promise<{ data: Array<{ client_subscription_price: number | null }> }>);
    assert.equal(rows[0].client_subscription_price, 25);
  });

  test(`piano ${plan}: prezzo sopra il minimo (es. 70€) viene accettato (200)`, async (t) => {
    setupRouteTest(t, seed());
    const res = await updatePrice(appId, 70, token);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.client_subscription_price, 70);
  });
}

test('tenant isolation: un utente non può modificare il prezzo di un\'app di un altro tenant', async (t) => {
  setupRouteTest(t, seed());
  const res = await updatePrice('app-pro', 70, 'tok-starter');
  assert.equal(res.status, 404);
});
