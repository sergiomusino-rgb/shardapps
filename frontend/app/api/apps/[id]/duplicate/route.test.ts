// ─── Test HTTP — POST /api/apps/[id]/duplicate (Pre-Beta Hardening, Blocco 9) ──
// Stesso harness/pattern di app/api/creator/publish/route.test.ts (stesso
// motore di creazione riusato: canCreateApp/reserveAppSlot/generateCreatorSlug).
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupRouteTest, importRoute, authHeaders } from '../../../../../src/lib/test-helpers/route-test-harness.ts';

const ROUTE_PATH = 'app/api/apps/[id]/duplicate/route.ts';

const SOURCE_CONFIG = {
  appName: 'Officina Rossi',
  sector: 'officina-meccanica',
  businessConfig: { name: 'Officina Rossi', language: 'it' },
  adminPanel: { entities: [{ name: 'clienti', label: 'Cliente', labelPlural: 'Clienti', fields: [{ id: 'nome', type: 'text', label: 'Nome' }] }] },
  pages: [{ slug: 'home', label: 'Home', sections: [] }],
  ui: { primaryColor: '#6366f1' },
  branding: { footer_logo_url: 'https://cdn.example/logo.png', footer_label: 'Agenzia Rossi' },
};

function seedOwnerTenant(overrides: Record<string, unknown> = {}) {
  return {
    tenants: [{ id: 'tenant-owner', owner_id: 'user-owner', plan: 'business', app_limit: 100, total_apps_created: 1, ...overrides }],
    tenant_members: [
      { id: 'tm-owner', tenant_id: 'tenant-owner', user_id: 'user-owner', role: 'owner' },
      { id: 'tm-attacker', tenant_id: 'tenant-attacker', user_id: 'user-attacker', role: 'owner' },
    ],
  };
}

async function callRoute(appId: string, body: unknown = {}, token?: string) {
  const { POST } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest(`http://localhost/api/apps/${appId}/duplicate`, {
    method: 'POST',
    headers: token ? authHeaders(token) : { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (POST as (r: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>)(req, { params: Promise.resolve({ id: appId }) });
}

test('401: nessun token', async (t) => {
  setupRouteTest(t, { seedTables: seedOwnerTenant() });
  const res = await callRoute('app-1');
  assert.equal(res.status, 401);
});

test('404: app sorgente inesistente', async (t) => {
  setupRouteTest(t, {
    seedTables: seedOwnerTenant(),
    authUsers: { 'tok-owner': { id: 'user-owner', email: 'owner@agenzia.it' } },
  });
  const res = await callRoute('non-esiste', {}, 'tok-owner');
  assert.equal(res.status, 404);
});

test('isolamento tenant: non è possibile duplicare l\'app di un\'altra agenzia (404, non 403 — mai confermare che esiste)', async (t) => {
  setupRouteTest(t, {
    seedTables: {
      ...seedOwnerTenant(),
      apps: [{ id: 'app-vittima', tenant_id: 'tenant-attacker', name: 'App Vittima', config: SOURCE_CONFIG, app_type: null }],
    },
    authUsers: { 'tok-owner': { id: 'user-owner', email: 'owner@agenzia.it' } },
  });
  const res = await callRoute('app-vittima', {}, 'tok-owner');
  assert.equal(res.status, 404);
});

test('comandi_ai non è duplicabile da questo endpoint', async (t) => {
  setupRouteTest(t, {
    seedTables: {
      ...seedOwnerTenant(),
      apps: [{ id: 'app-1', tenant_id: 'tenant-owner', name: 'ComandAI Bar', config: SOURCE_CONFIG, app_type: 'comandi_ai' }],
    },
    authUsers: { 'tok-owner': { id: 'user-owner', email: 'owner@agenzia.it' } },
  });
  const res = await callRoute('app-1', {}, 'tok-owner');
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'UNSUPPORTED_APP_TYPE');
});

test('201: duplica l\'app — nuova riga nello stesso tenant, id/slug diversi, password fresca in chiaro nella risposta', async (t) => {
  const { supabase } = setupRouteTest(t, {
    seedTables: {
      ...seedOwnerTenant(),
      apps: [{ id: 'app-1', tenant_id: 'tenant-owner', name: 'Officina Rossi', config: SOURCE_CONFIG, app_type: null, client_email: 'cliente-originale@privato.it' }],
    },
    authUsers: { 'tok-owner': { id: 'user-owner', email: 'owner@agenzia.it' } },
  });
  const res = await callRoute('app-1', {}, 'tok-owner');
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.notEqual(body.app.id, 'app-1');
  assert.notEqual(body.app.slug, undefined);
  assert.ok(body.password, 'la password in chiaro è restituita SOLO in questa risposta di creazione');

  const { data: apps } = await supabase.from('apps').select('*').eq('id', body.app.id).maybeSingle();
  const newApp = apps as { tenant_id: string; client_email: string; client_password: string; config: { appName: string; sector: string; branding: unknown } };
  assert.equal(newApp.tenant_id, 'tenant-owner', 'appartiene al tenant corretto (il chiamante)');
  assert.notEqual(newApp.client_email, 'cliente-originale@privato.it', 'mai l\'email del cliente originale');
  assert.equal(newApp.client_email, 'owner@agenzia.it', 'usa l\'email del chiamante come default');
  assert.notEqual(newApp.client_password, body.password, 'la password persistita è l\'hash, mai il valore in chiaro');
  assert.match(newApp.client_password, /^\$2[aby]\$/);
  assert.equal(newApp.config.appName, body.app.name);
  assert.equal(newApp.config.sector, 'officina-meccanica', 'la configurazione (progetto) è stata copiata');
  assert.deepEqual(newApp.config.branding, SOURCE_CONFIG.branding, 'il branding reseller viene copiato (non è dato cliente)');
});

test('la duplicazione consuma uno slot del piano (stesso motore di /api/creator/publish)', async (t) => {
  const { supabase } = setupRouteTest(t, {
    seedTables: {
      ...seedOwnerTenant({ total_apps_created: 0 }),
      apps: [{ id: 'app-1', tenant_id: 'tenant-owner', name: 'Officina Rossi', config: SOURCE_CONFIG, app_type: null }],
    },
    authUsers: { 'tok-owner': { id: 'user-owner', email: 'owner@agenzia.it' } },
  });
  await callRoute('app-1', {}, 'tok-owner');
  const { data: tenantRows } = await (supabase.from('tenants').select('*').eq('id', 'tenant-owner') as unknown as Promise<{ data: Array<{ total_apps_created: number }> }>);
  assert.equal(tenantRows[0].total_apps_created, 1);
});

test('403 SlotsExhausted: non duplica se il tenant ha esaurito gli slot', async (t) => {
  setupRouteTest(t, {
    seedTables: {
      ...seedOwnerTenant({ plan: 'starter', app_limit: 1, total_apps_created: 1 }),
      apps: [{ id: 'app-1', tenant_id: 'tenant-owner', name: 'Officina Rossi', config: SOURCE_CONFIG, app_type: null }],
    },
    authUsers: { 'tok-owner': { id: 'user-owner', email: 'owner@agenzia.it' } },
  });
  const res = await callRoute('app-1', {}, 'tok-owner');
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, 'SLOTS_EXHAUSTED');
});

test('un\'app rbac duplicata riceve un admin rbac FRESCO (email del chiamante), non gli utenti rbac della sorgente', async (t) => {
  const rbacConfig = { ...SOURCE_CONFIG, authConfig: { enabled: true, supportedRoles: ['admin', 'operator'], defaultRole: 'viewer' } };
  const { supabase } = setupRouteTest(t, {
    seedTables: {
      ...seedOwnerTenant(),
      apps: [{ id: 'app-1', tenant_id: 'tenant-owner', name: 'Gestionale RBAC', config: rbacConfig, app_type: null }],
      app_rbac_users: [{ id: 'rbac-1', app_id: 'app-1', tenant_id: 'tenant-owner', client_email: 'admin-originale@privato.it', client_password: 'x', role: 'admin' }],
    },
    authUsers: { 'tok-owner': { id: 'user-owner', email: 'owner@agenzia.it' } },
  });
  const res = await callRoute('app-1', {}, 'tok-owner');
  assert.equal(res.status, 201);
  const body = await res.json();

  const { data: newRbacUsers } = await supabase.from('app_rbac_users').select('*').eq('app_id', body.app.id);
  const rows = newRbacUsers as Array<{ client_email: string; client_password: string }>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].client_email, 'owner@agenzia.it', 'mai l\'email dell\'admin originale');
  assert.match(rows[0].client_password, /^\$2[aby]\$/, 'password hashata, mai in chiaro');
});

test('nome personalizzato: se fornito, sovrascrive il nome di default "(copia)"', async (t) => {
  setupRouteTest(t, {
    seedTables: {
      ...seedOwnerTenant(),
      apps: [{ id: 'app-1', tenant_id: 'tenant-owner', name: 'Officina Rossi', config: SOURCE_CONFIG, app_type: null }],
    },
    authUsers: { 'tok-owner': { id: 'user-owner', email: 'owner@agenzia.it' } },
  });
  const res = await callRoute('app-1', { name: 'Officina Bianchi' }, 'tok-owner');
  const body = await res.json();
  assert.equal(body.app.name, 'Officina Bianchi');
});
