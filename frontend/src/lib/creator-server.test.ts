// ─── Test: Private Beta entitlement (Blocco 1/2) ────────────────────────────
// Copre solo il comportamento nuovo/modificato in questo task: bypass del
// paywall per un tenant con beta_access=true (canCreateApp/reserveAppSlot) e
// l'attribuzione di beta_access alla creazione del tenant (getOrCreateTenant)
// in base a beta_applications.status='approved'. Non ri-testa da zero la
// logica di slot preesistente (già coperta altrove) — solo il delta.
//
// creator-server.ts importa @/app/actions/comandi-provisioning (alias di
// path, valido solo con la risoluzione Next.js/tsconfig): un import statico
// in cima a questo file fallirebbe sotto `node --test` puro. Si usa quindi
// lo stesso loader di risoluzione alias già registrato da
// route-test-harness.ts::setupRouteTest per i test HTTP delle route
// Creator, e un import dinamico DOPO la registrazione — stesso identico
// pattern di importRoute() in quel file, applicato qui a un modulo di
// libreria invece che a una route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeSupabase } from './test-helpers/fake-supabase.ts';
import { setupRouteTest } from './test-helpers/route-test-harness.ts';

async function importCreatorServer() {
  setupRouteTest(null, {}); // no-op per i fake globali usati qui: registra solo il loader di alias
  return import('./creator-server.ts');
}

function seedTenant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tenant-1',
    plan: 'free',
    app_limit: 0,
    total_apps_created: 0,
    beta_access: false,
    ...overrides,
  };
}

// ─── canCreateApp ───────────────────────────────────────────────────────────

test('canCreateApp: tenant free (app_limit 0, beta_access false) -> SlotsExhausted', async () => {
  const { canCreateApp } = await importCreatorServer();
  const supabase = makeFakeSupabase({}, { tenants: [seedTenant()] });
  const result = await canCreateApp(supabase, 'tenant-1', 'user-1');
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'SlotsExhausted');
});

test('canCreateApp: tenant free con beta_access true -> allowed, nessun redirect a /pricing', async () => {
  const { canCreateApp } = await importCreatorServer();
  const supabase = makeFakeSupabase({}, { tenants: [seedTenant({ beta_access: true })] });
  const result = await canCreateApp(supabase, 'tenant-1', 'user-1');
  assert.equal(result.allowed, true);
  assert.equal(result.reason, undefined);
});

test('canCreateApp: tenant NON beta con slot regolari disponibili resta invariato (comportamento commerciale normale)', async () => {
  const { canCreateApp } = await importCreatorServer();
  const supabase = makeFakeSupabase({}, {
    tenants: [seedTenant({ plan: 'starter', app_limit: 1, total_apps_created: 0 })],
  });
  const result = await canCreateApp(supabase, 'tenant-1', 'user-1');
  assert.equal(result.allowed, true);
});

test('canCreateApp: tenant NON beta con slot esauriti resta bloccato (nessun bypass globale)', async () => {
  const { canCreateApp } = await importCreatorServer();
  const supabase = makeFakeSupabase({}, {
    tenants: [seedTenant({ plan: 'starter', app_limit: 1, total_apps_created: 1 })],
  });
  const result = await canCreateApp(supabase, 'tenant-1', 'user-1');
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'SlotsExhausted');
});

// ─── reserveAppSlot ──────────────────────────────────────────────────────────
// Simula la guardia SQL reale di increment_tenant_app_count dopo la migration
// 20260830000000 (WHERE total_apps_created < app_limit OR beta_access = true):
// stesso comportamento del vero RPC Postgres, replicato qui come rpcHandler
// perché il fake Supabase non esegue SQL reale.

function atomicIncrementHandler(tenants: Array<Record<string, unknown>>) {
  return (params: Record<string, unknown>) => {
    const tenant = tenants.find((t) => t.id === params.p_tenant_id);
    if (!tenant) return { data: [], error: null };
    const canIncrement = (tenant.total_apps_created as number) < (tenant.app_limit as number) || tenant.beta_access === true;
    if (!canIncrement) return { data: [], error: null };
    tenant.total_apps_created = (tenant.total_apps_created as number) + 1;
    return { data: [{ total_apps_created: tenant.total_apps_created, app_limit: tenant.app_limit }], error: null };
  };
}

test('reserveAppSlot: tenant beta con app_limit 0 riserva comunque uno slot (RPC atomica)', async () => {
  const { reserveAppSlot } = await importCreatorServer();
  const tenant = seedTenant({ beta_access: true });
  const supabase = makeFakeSupabase({}, { tenants: [tenant] }, {
    rpcHandlers: { increment_tenant_app_count: atomicIncrementHandler([tenant]) },
  });
  const result = await reserveAppSlot(supabase, 'tenant-1', tenant, 'user-1');
  assert.equal(result.ok, true);
  assert.equal(tenant.total_apps_created, 1);
});

test('reserveAppSlot: tenant NON beta con app_limit 0 resta SlotsExhausted (RPC atomica)', async () => {
  const { reserveAppSlot } = await importCreatorServer();
  const tenant = seedTenant({ beta_access: false });
  const supabase = makeFakeSupabase({}, { tenants: [tenant] }, {
    rpcHandlers: { increment_tenant_app_count: atomicIncrementHandler([tenant]) },
  });
  const result = await reserveAppSlot(supabase, 'tenant-1', tenant, 'user-1');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'SlotsExhausted');
});

test('reserveAppSlot: fallback non atomico (RPC non ancora migrata, code 42883) rispetta comunque beta_access', async () => {
  const { reserveAppSlot } = await importCreatorServer();
  const supabase = makeFakeSupabase({}, { tenants: [] }, {
    rpcHandlers: {
      increment_tenant_app_count: () => ({ data: null, error: { message: 'function not found', code: '42883' } }),
    },
  });
  const betaTenant = { total_apps_created: 0, app_limit: 0, beta_access: true };
  const result = await reserveAppSlot(supabase, 'tenant-1', betaTenant, 'user-1');
  assert.equal(result.ok, true);
});

test('reserveAppSlot: fallback non atomico, tenant NON beta con slot esauriti resta bloccato', async () => {
  const { reserveAppSlot } = await importCreatorServer();
  const supabase = makeFakeSupabase({}, { tenants: [] }, {
    rpcHandlers: {
      increment_tenant_app_count: () => ({ data: null, error: { message: 'function not found', code: '42883' } }),
    },
  });
  const freeTenant = { total_apps_created: 0, app_limit: 0, beta_access: false };
  const result = await reserveAppSlot(supabase, 'tenant-1', freeTenant, 'user-1');
  assert.equal(result.ok, false);
});

// ─── getOrCreateTenant ───────────────────────────────────────────────────────

test('getOrCreateTenant: email con candidatura beta_applications approvata -> nuovo tenant con beta_access true', async () => {
  const { getOrCreateTenant } = await importCreatorServer();
  const supabase = makeFakeSupabase({}, {
    beta_applications: [{ id: 'ba-1', email: 'agenzia@esempio.it', status: 'approved' }],
  });
  const tenantId = await getOrCreateTenant(supabase, { id: 'user-1', email: 'agenzia@esempio.it' });
  const { data: tenant } = await supabase.from('tenants').select().eq('id', tenantId).maybeSingle();
  assert.equal(tenant.beta_access, true);
  // Il modello commerciale resta invariato: plan/app_limit di default, mai
  // toccati dall'entitlement beta.
  assert.equal(tenant.plan, 'free');
  assert.equal(tenant.app_limit, 0);
});

test('getOrCreateTenant: email senza candidatura approvata -> nuovo tenant con beta_access false (comportamento invariato)', async () => {
  const { getOrCreateTenant } = await importCreatorServer();
  const supabase = makeFakeSupabase({}, { beta_applications: [] });
  const tenantId = await getOrCreateTenant(supabase, { id: 'user-2', email: 'sconosciuto@esempio.it' });
  const { data: tenant } = await supabase.from('tenants').select().eq('id', tenantId).maybeSingle();
  assert.equal(tenant.beta_access, false);
});

test('getOrCreateTenant: candidatura esistente ma non ancora approvata (status "new") -> beta_access false', async () => {
  const { getOrCreateTenant } = await importCreatorServer();
  const supabase = makeFakeSupabase({}, {
    beta_applications: [{ id: 'ba-2', email: 'in-attesa@esempio.it', status: 'new' }],
  });
  const tenantId = await getOrCreateTenant(supabase, { id: 'user-3', email: 'in-attesa@esempio.it' });
  const { data: tenant } = await supabase.from('tenants').select().eq('id', tenantId).maybeSingle();
  assert.equal(tenant.beta_access, false);
});
