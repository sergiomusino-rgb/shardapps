// ─── Test HTTP — GET/PATCH /api/apps/[id] (branding reseller) ──────────────
// (CreatorAI Engine 2.0 — Branding reseller)
//
// Route REALE e INVARIATA (nessuna modifica in questo lavoro): il pannello
// Branding di CreatorAI la riusa così com'è per persistere/leggere
// apps.config.branding (nessuna nuova route). Qui si verifica che questo
// riuso sia sicuro: isolamento tenant, gate piano Business, limite
// dimensione logo, persistenza reale in apps.config — tutto codice
// pre-esistente, testato per la prima volta qui. Vedi
// src/lib/test-helpers/route-test-harness.ts per il "perché" dell'approccio
// e per il supporto al pattern auth di QUESTA route (createClient con
// global.headers.Authorization + .auth.getUser() senza argomenti).
//
// Uso: node --experimental-test-module-mocks --test "app/api/apps/[id]/route.test.ts"
// (dalla cartella frontend/).

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupRouteTest, importRoute, authHeaders } from '../../../../src/lib/test-helpers/route-test-harness.ts';

const ROUTE_PATH = 'app/api/apps/[id]/route.ts';

function seed(overrides: { tenantPlan?: string } = {}) {
  return {
    seedTables: {
      tenants: [
        { id: 'tenant-owner', owner_id: 'user-owner', plan: overrides.tenantPlan ?? 'business' },
        { id: 'tenant-attacker', owner_id: 'user-attacker', plan: 'business' },
      ],
      tenant_members: [
        { id: 'tm-1', tenant_id: 'tenant-owner', user_id: 'user-owner', role: 'owner' },
        { id: 'tm-2', tenant_id: 'tenant-attacker', user_id: 'user-attacker', role: 'owner' },
      ],
      apps: [
        { id: 'app-1', tenant_id: 'tenant-owner', name: 'Officina Rossi', config: { appName: 'Officina Rossi', businessConfig: { name: 'Officina Rossi' } } },
      ],
    },
    authUsers: {
      'tok-owner': { id: 'user-owner', email: 'owner@example.com' },
      'tok-attacker': { id: 'user-attacker', email: 'attacker@example.com' },
    },
  };
}

async function patchBranding(appId: string, branding: Record<string, unknown>, token: string) {
  const { PATCH } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest(`http://localhost/api/apps/${appId}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ branding }),
  });
  return (PATCH as (r: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>)(req, { params: Promise.resolve({ id: appId }) });
}

async function getApp(appId: string, token: string) {
  const { GET } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest(`http://localhost/api/apps/${appId}`, { headers: authHeaders(token) });
  return (GET as (r: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>)(req, { params: Promise.resolve({ id: appId }) });
}

async function patchNotificationPreferences(appId: string, notificationPreferences: unknown, token: string) {
  const { PATCH } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest(`http://localhost/api/apps/${appId}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ notificationPreferences }),
  });
  return (PATCH as (r: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>)(req, { params: Promise.resolve({ id: appId }) });
}

const LOGO = 'data:image/png;base64,iVBORw0KGgo=';

test('1./9. branding completo su piano Business -> 200, apps.config.branding aggiornato realmente', async (t) => {
  const setup = setupRouteTest(t, seed());
  const res = await patchBranding('app-1', { footer_logo_url: LOGO, footer_label: 'Studio Rossi' }, 'tok-owner');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.app.config.branding.footer_label, 'Studio Rossi');
  assert.equal(body.app.config.branding.footer_logo_url, LOGO);

  const { data: rows } = await (setup.supabase.from('apps').select('*').eq('id', 'app-1') as unknown as Promise<{ data: Array<{ config: { branding?: { footer_label?: string } } }> }>);
  assert.equal(rows[0].config.branding?.footer_label, 'Studio Rossi');
});

test('piano non Business -> 403 PLAN_REQUIRED, apps.config invariato (nessun bypass del gate esistente)', async (t) => {
  const setup = setupRouteTest(t, seed({ tenantPlan: 'starter' }));
  const res = await patchBranding('app-1', { footer_logo_url: LOGO, footer_label: 'Studio Rossi' }, 'tok-owner');
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.code, 'PLAN_REQUIRED');

  const { data: rows } = await (setup.supabase.from('apps').select('*').eq('id', 'app-1') as unknown as Promise<{ data: Array<{ config: { branding?: unknown } }> }>);
  assert.equal(rows[0].config.branding, undefined);
});

test('6. tenant isolation: un altro tenant non può scrivere branding su un\'app che non è sua', async (t) => {
  const setup = setupRouteTest(t, seed());
  const res = await patchBranding('app-1', { footer_logo_url: LOGO, footer_label: 'Hijack' }, 'tok-attacker');
  assert.equal(res.status, 404);

  const { data: rows } = await (setup.supabase.from('apps').select('*').eq('id', 'app-1') as unknown as Promise<{ data: Array<{ config: { branding?: unknown } }> }>);
  assert.equal(rows[0].config.branding, undefined); // invariato
});

test('8. logo oltre il limite di dimensione viene rifiutato lato server (400), nessuna scrittura parziale', async (t) => {
  const setup = setupRouteTest(t, seed());
  const oversized = 'data:image/png;base64,' + 'A'.repeat(1_600_000);
  const res = await patchBranding('app-1', { footer_logo_url: oversized, footer_label: 'Studio Rossi' }, 'tok-owner');
  assert.equal(res.status, 400);

  const { data: rows } = await (setup.supabase.from('apps').select('*').eq('id', 'app-1') as unknown as Promise<{ data: Array<{ config: { branding?: unknown } }> }>);
  assert.equal(rows[0].config.branding, undefined);
});

test('GET restituisce apps.config.branding (usato da fetchCurrentBranding per pre-compilare il pannello)', async (t) => {
  setupRouteTest(t, seed());
  await patchBranding('app-1', { footer_logo_url: LOGO, footer_label: 'Studio Rossi' }, 'tok-owner');
  const res = await getApp('app-1', 'tok-owner');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.app.config.branding.footer_label, 'Studio Rossi');
});

test('GET: un altro tenant non può leggere l\'app (403), stesso isolamento del PATCH', async (t) => {
  setupRouteTest(t, seed());
  const res = await getApp('app-1', 'tok-attacker');
  assert.equal(res.status, 403);
});

// ─── notificationPreferences (Notifications, Round 2) ──────────────────────
test('notificationPreferences.email=false -> 200, apps.notification_preferences aggiornato realmente', async (t) => {
  const setup = setupRouteTest(t, seed());
  const res = await patchNotificationPreferences('app-1', { email: false }, 'tok-owner');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.app.notification_preferences.email, false);

  const { data: rows } = await (setup.supabase.from('apps').select('*').eq('id', 'app-1') as unknown as Promise<{ data: Array<{ notification_preferences?: { email?: boolean } }> }>);
  assert.equal(rows[0].notification_preferences?.email, false);
});

test('notificationPreferences.email non booleano -> 400, nessuna scrittura', async (t) => {
  const setup = setupRouteTest(t, seed());
  const res = await patchNotificationPreferences('app-1', { email: 'no' }, 'tok-owner');
  assert.equal(res.status, 400);

  const { data: rows } = await (setup.supabase.from('apps').select('*').eq('id', 'app-1') as unknown as Promise<{ data: Array<{ notification_preferences?: unknown }> }>);
  assert.equal(rows[0].notification_preferences, undefined);
});

test('notificationPreferences: tenant isolation, un altro tenant non può disattivare le email di un\'app che non è sua', async (t) => {
  const setup = setupRouteTest(t, seed());
  const res = await patchNotificationPreferences('app-1', { email: false }, 'tok-attacker');
  assert.equal(res.status, 404);

  const { data: rows } = await (setup.supabase.from('apps').select('*').eq('id', 'app-1') as unknown as Promise<{ data: Array<{ notification_preferences?: unknown }> }>);
  assert.equal(rows[0].notification_preferences, undefined); // invariato
});

test('notificationPreferences: nessun piano richiesto (a differenza del branding)', async (t) => {
  setupRouteTest(t, seed({ tenantPlan: 'starter' }));
  const res = await patchNotificationPreferences('app-1', { email: false }, 'tok-owner');
  assert.equal(res.status, 200);
});

// ─── DELETE — regola di scadenza allineata a expires_at OR trial_ends_at ───
// Prima del fix, il backend considerava scaduta solo expires_at: un'app col
// solo trial scaduto (expires_at ancora NULL, il caso comune per un'app mai
// passata a un piano commerciale) restava "attiva" agli occhi del DELETE
// nonostante la UI (dashboard/projects/page.tsx::getStatusBadge, stessa
// regola qui sotto) la mostrasse già come "Scaduta" — il pulsante cestino
// compariva ma il DELETE falliva sempre con 400.

function seedForDelete(appOverrides: Record<string, unknown>) {
  return {
    seedTables: {
      tenants: [
        { id: 'tenant-owner', owner_id: 'user-owner', plan: 'business' },
        { id: 'tenant-attacker', owner_id: 'user-attacker', plan: 'business' },
      ],
      tenant_members: [
        { id: 'tm-1', tenant_id: 'tenant-owner', user_id: 'user-owner', role: 'owner' },
        { id: 'tm-2', tenant_id: 'tenant-attacker', user_id: 'user-attacker', role: 'owner' },
      ],
      apps: [
        { id: 'app-1', tenant_id: 'tenant-owner', name: 'Officina Rossi', client_active: true, expires_at: null, trial_ends_at: null, ...appOverrides },
      ],
    },
    authUsers: {
      'tok-owner': { id: 'user-owner', email: 'owner@example.com' },
      'tok-attacker': { id: 'user-attacker', email: 'attacker@example.com' },
    },
  };
}

async function deleteApp(appId: string, token: string) {
  const { DELETE } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest(`http://localhost/api/apps/${appId}`, { method: 'DELETE', headers: authHeaders(token) });
  return (DELETE as (r: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>)(req, { params: Promise.resolve({ id: appId }) });
}

const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

test('DELETE 1: app scaduta tramite expires_at -> eliminabile', async (t) => {
  const setup = setupRouteTest(t, seedForDelete({ expires_at: PAST }));
  const res = await deleteApp('app-1', 'tok-owner');
  assert.equal(res.status, 200);
  const { data: rows } = await (setup.supabase.from('apps').select('*').eq('id', 'app-1') as unknown as Promise<{ data: unknown[] }>);
  assert.equal(rows.length, 0);
});

test('DELETE 2: app scaduta tramite trial_ends_at con expires_at NULL -> eliminabile (regressione corretta)', async (t) => {
  const setup = setupRouteTest(t, seedForDelete({ expires_at: null, trial_ends_at: PAST }));
  const res = await deleteApp('app-1', 'tok-owner');
  assert.equal(res.status, 200);
  const { data: rows } = await (setup.supabase.from('apps').select('*').eq('id', 'app-1') as unknown as Promise<{ data: unknown[] }>);
  assert.equal(rows.length, 0);
});

test('DELETE 3: app client_active=false -> eliminabile anche se non scaduta', async (t) => {
  const setup = setupRouteTest(t, seedForDelete({ client_active: false, expires_at: FUTURE, trial_ends_at: null }));
  const res = await deleteApp('app-1', 'tok-owner');
  assert.equal(res.status, 200);
  const { data: rows } = await (setup.supabase.from('apps').select('*').eq('id', 'app-1') as unknown as Promise<{ data: unknown[] }>);
  assert.equal(rows.length, 0);
});

test('DELETE 4: app attiva e non scaduta -> 400, NON eliminabile', async (t) => {
  const setup = setupRouteTest(t, seedForDelete({ client_active: true, expires_at: FUTURE, trial_ends_at: FUTURE }));
  const res = await deleteApp('app-1', 'tok-owner');
  assert.equal(res.status, 400);
  const { data: rows } = await (setup.supabase.from('apps').select('*').eq('id', 'app-1') as unknown as Promise<{ data: unknown[] }>);
  assert.equal(rows.length, 1); // invariata
});

test('DELETE 4b: app attiva senza alcuna data di scadenza (entrambe NULL) -> 400, NON eliminabile', async (t) => {
  const setup = setupRouteTest(t, seedForDelete({ client_active: true, expires_at: null, trial_ends_at: null }));
  const res = await deleteApp('app-1', 'tok-owner');
  assert.equal(res.status, 400);
  const { data: rows } = await (setup.supabase.from('apps').select('*').eq('id', 'app-1') as unknown as Promise<{ data: unknown[] }>);
  assert.equal(rows.length, 1);
});

test('DELETE 5: app di un altro tenant -> 403, NON eliminabile (isolamento invariato)', async (t) => {
  const setup = setupRouteTest(t, seedForDelete({ expires_at: PAST })); // scaduta, ma non è dell'attaccante
  const res = await deleteApp('app-1', 'tok-attacker');
  assert.equal(res.status, 403);
  const { data: rows } = await (setup.supabase.from('apps').select('*').eq('id', 'app-1') as unknown as Promise<{ data: unknown[] }>);
  assert.equal(rows.length, 1); // invariata
});
