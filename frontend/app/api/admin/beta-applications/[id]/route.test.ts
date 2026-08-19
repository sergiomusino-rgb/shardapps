// ─── Test HTTP — PATCH /api/admin/beta-applications/:id ────────────────────
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupRouteTest, importRoute, authHeaders } from '../../../../../src/lib/test-helpers/route-test-harness.ts';

const ROUTE_PATH = 'app/api/admin/beta-applications/[id]/route.ts';
const ADMIN_USER_ID = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';

function seedApplications() {
  return [{ id: 'a1', full_name: 'Mario Rossi', company_name: 'Rossi Agency', email: 'mario@rossi.it', status: 'new' }];
}

async function callRoute(id: string, body: unknown, token?: string) {
  const { PATCH } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest(`http://localhost/api/admin/beta-applications/${id}`, {
    method: 'PATCH',
    headers: token ? authHeaders(token) : { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (PATCH as (r: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>)(req, { params: Promise.resolve({ id }) });
}

test('403: non admin -> cambio status rifiutato', async (t) => {
  setupRouteTest(t, {
    seedTables: { beta_applications: seedApplications() },
    authUsers: { 'token-user': { id: 'user-1' } },
  });
  const res = await callRoute('a1', { status: 'approved' }, 'token-user');
  assert.equal(res.status, 403);
});

test('200: admin cambia lo status a "approved"', async (t) => {
  const { supabase } = setupRouteTest(t, {
    seedTables: { beta_applications: seedApplications() },
    authUsers: { 'token-admin': { id: ADMIN_USER_ID } },
  });
  const res = await callRoute('a1', { status: 'approved' }, 'token-admin');
  assert.equal(res.status, 200);
  const body = await res.json() as { application: { id: string; status: string } };
  assert.equal(body.application.status, 'approved');

  const { data } = await supabase.from('beta_applications').select('*').eq('id', 'a1').maybeSingle();
  assert.equal((data as { status: string }).status, 'approved');
});

test('400: status non nel vocabolario ammesso', async (t) => {
  setupRouteTest(t, {
    seedTables: { beta_applications: seedApplications() },
    authUsers: { 'token-admin': { id: ADMIN_USER_ID } },
  });
  const res = await callRoute('a1', { status: 'not-a-real-status' }, 'token-admin');
  assert.equal(res.status, 400);
});

test('404: candidatura inesistente', async (t) => {
  setupRouteTest(t, {
    seedTables: { beta_applications: seedApplications() },
    authUsers: { 'token-admin': { id: ADMIN_USER_ID } },
  });
  const res = await callRoute('non-esiste', { status: 'approved' }, 'token-admin');
  assert.equal(res.status, 404);
});

test('tutti gli status del vocabolario sono accettati: new, reviewing, approved, rejected, contacted', async (t) => {
  for (const status of ['new', 'reviewing', 'approved', 'rejected', 'contacted']) {
    setupRouteTest(t, {
      seedTables: { beta_applications: seedApplications() },
      authUsers: { 'token-admin': { id: ADMIN_USER_ID } },
    });
    const res = await callRoute('a1', { status }, 'token-admin');
    assert.equal(res.status, 200, `status "${status}" dovrebbe essere accettato`);
  }
});

// ─── Private Beta (Blocco 2): sincronizzazione tenants.beta_access ─────────
// Copre solo il caso limite descritto in syncTenantBetaAccess: un tenant che
// esiste GIA' per l'email della candidatura (utente pre-esistente, o
// approvato dopo un primo tentativo di signup). Il caso comune (tenant creato
// DOPO l'approvazione) è coperto da creator-server.test.ts::getOrCreateTenant.

test('PATCH a "approved": se esiste già un tenant per quella email, imposta beta_access=true', async (t) => {
  const { supabase } = setupRouteTest(t, {
    seedTables: {
      beta_applications: seedApplications(),
      tenants: [{ id: 'tenant-1', owner_id: 'owner-1', beta_access: false }],
    },
    authUsers: { 'token-admin': { id: ADMIN_USER_ID } },
    rpcHandlers: {
      find_owned_tenant_id_by_email: (params) =>
        params.p_email === 'mario@rossi.it' ? { data: 'tenant-1', error: null } : { data: null, error: null },
    },
  });

  const res = await callRoute('a1', { status: 'approved' }, 'token-admin');
  assert.equal(res.status, 200);

  const { data: tenant } = await supabase.from('tenants').select().eq('id', 'tenant-1').maybeSingle();
  assert.equal(tenant.beta_access, true);
});

test('PATCH a "rejected": se esiste già un tenant per quella email (già approvato in precedenza), revoca beta_access', async (t) => {
  const { supabase } = setupRouteTest(t, {
    seedTables: {
      beta_applications: seedApplications(),
      tenants: [{ id: 'tenant-1', owner_id: 'owner-1', beta_access: true }],
    },
    authUsers: { 'token-admin': { id: ADMIN_USER_ID } },
    rpcHandlers: {
      find_owned_tenant_id_by_email: (params) =>
        params.p_email === 'mario@rossi.it' ? { data: 'tenant-1', error: null } : { data: null, error: null },
    },
  });

  const res = await callRoute('a1', { status: 'rejected' }, 'token-admin');
  assert.equal(res.status, 200);

  const { data: tenant } = await supabase.from('tenants').select().eq('id', 'tenant-1').maybeSingle();
  assert.equal(tenant.beta_access, false);
});

test('PATCH a "approved": nessun tenant ancora esistente per l\'email -> risposta 200 invariata (sync è un no-op silenzioso)', async (t) => {
  setupRouteTest(t, {
    seedTables: { beta_applications: seedApplications() }, // nessun tenant seedato
    authUsers: { 'token-admin': { id: ADMIN_USER_ID } },
    // find_owned_tenant_id_by_email non configurata: fake RPC risponde con
    // l'errore di default "funzione non disponibile" (42883) — la sync deve
    // limitarsi a loggare e non toccare la risposta HTTP.
  });
  const res = await callRoute('a1', { status: 'approved' }, 'token-admin');
  assert.equal(res.status, 200);
  const body = await res.json() as { application: { status: string } };
  assert.equal(body.application.status, 'approved');
});
