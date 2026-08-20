// ─── Test HTTP — POST /api/a/[slug]/update-credentials (P0-4, root-cause
// report "Settings/Login" — 3 bug frontend confermati) ──────────────────────
// Questo file copre il CONTRATTO REALE del backend (mai richiesto/atteso una
// "password attuale" — TEST G del task) e l'enforcement dell'Authorization
// Bearer che il frontend prima non inviava (TEST E, verificato qui a livello
// di route dato che il componente React non è testabile senza jsdom/RTL,
// non presenti in questo repo — vedi report finale per la nota su E/F).

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupRouteTest, importRoute, authHeaders } from '../../../../../src/lib/test-helpers/route-test-harness.ts';
import { looksHashed } from '../../../../../src/lib/password-hash.ts';

const ROUTE_PATH = 'app/api/a/[slug]/update-credentials/route.ts';

function baseSetup(extra: Parameters<typeof setupRouteTest>[1] = {}) {
  const { seedTables: extraSeed, authUsers: extraAuth, ...rest } = extra;
  return {
    seedTables: {
      apps: [{ id: 'app-1', slug: 'officina-rossi', tenant_id: 'tenant-1', client_email: 'vecchia@officina-rossi.it', client_password: 'hash-vecchio' }],
      tenant_members: [{ id: 'tm-1', tenant_id: 'tenant-1', user_id: 'user-1' }],
      ...(extraSeed || {}),
    },
    authUsers: { 'tok-1': { id: 'user-1', email: 'reseller@example.com' }, ...(extraAuth || {}) },
    ...rest,
  };
}

async function postUpdateCredentials(slug: string, body: Record<string, unknown>, token?: string) {
  const { POST } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest(`http://localhost/api/a/${slug}/update-credentials`, {
    method: 'POST',
    headers: token ? authHeaders(token) : { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (POST as (r: Request, ctx: { params: Promise<{ slug: string }> }) => Promise<Response>)(
    req, { params: Promise.resolve({ slug }) }
  );
}

// ─── TEST E (proxy a livello route, il frontend è coperto da code review —
// vedi report finale): l'endpoint richiede sempre Authorization Bearer. ────
test('TEST E — 401 senza Authorization header (il bug era che il frontend non lo inviava affatto)', async (t) => {
  setupRouteTest(t, baseSetup());
  const res = await postUpdateCredentials('officina-rossi', { client_email: 'nuova@officina-rossi.it' });
  assert.equal(res.status, 401);
});

test('401: token presente ma non risolve a nessun utente', async (t) => {
  setupRouteTest(t, baseSetup());
  const res = await postUpdateCredentials('officina-rossi', { client_email: 'nuova@officina-rossi.it' }, 'tok-non-valido');
  assert.equal(res.status, 401);
});

test('403: l\'app appartiene a un tenant diverso da quello del chiamante', async (t) => {
  setupRouteTest(t, baseSetup({
    seedTables: {
      apps: [{ id: 'app-1', slug: 'officina-rossi', tenant_id: 'tenant-DIVERSO', client_email: 'x@x.it', client_password: 'hash' }],
    },
  }));
  const res = await postUpdateCredentials('officina-rossi', { client_email: 'nuova@officina-rossi.it' }, 'tok-1');
  assert.equal(res.status, 403);
});

test('400: email non valida', async (t) => {
  setupRouteTest(t, baseSetup());
  const res = await postUpdateCredentials('officina-rossi', { client_email: 'non-una-email' }, 'tok-1');
  assert.equal(res.status, 400);
});

test('400: nuova password troppo corta', async (t) => {
  setupRouteTest(t, baseSetup());
  const res = await postUpdateCredentials('officina-rossi', { client_email: 'nuova@officina-rossi.it', client_password: 'corta' }, 'tok-1');
  assert.equal(res.status, 400);
});

// ─── TEST G del task: il backend non ha mai richiesto/atteso una "password
// attuale" — un aggiornamento con solo client_email + client_password (senza
// alcun campo tipo currentPassword/oldPassword) deve riuscire. ─────────────
test('TEST G — successo con SOLA client_email + client_password: nessun campo "password attuale" nel contratto reale', async (t) => {
  const setup = setupRouteTest(t, baseSetup());
  const res = await postUpdateCredentials('officina-rossi', {
    client_email: 'nuova@officina-rossi.it',
    client_password: 'NuovaPassword123',
    // Deliberatamente NESSUN currentPassword/oldPassword nel body: il bug
    // frontend lo richiedeva senza che il backend lo controllasse mai.
  }, 'tok-1');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);

  const { data } = await (setup.supabase.from('apps').select('*').eq('id', 'app-1') as unknown as Promise<{ data: Array<{ client_email: string; client_password: string }> }>);
  assert.equal(data[0].client_email, 'nuova@officina-rossi.it');
  assert.ok(looksHashed(data[0].client_password), 'la nuova password è persistita come hash bcrypt, mai in chiaro');
  assert.notEqual(data[0].client_password, 'hash-vecchio');

  const { data: creds } = await (setup.supabase.from('app_credentials').select('*').eq('app_id', 'app-1') as unknown as Promise<{ data: Array<{ client_password: string }> }>);
  assert.equal(creds.length, 1, 'dual-write anche su app_credentials (stesso comportamento pre-esistente)');
  assert.ok(looksHashed(creds[0].client_password));
});

test('solo email, nessuna password: la password esistente resta INVARIATA (comportamento pre-esistente, non toccato da P0-4)', async (t) => {
  const setup = setupRouteTest(t, baseSetup());
  const res = await postUpdateCredentials('officina-rossi', { client_email: 'nuova@officina-rossi.it' }, 'tok-1');
  assert.equal(res.status, 200);

  const { data } = await (setup.supabase.from('apps').select('*').eq('id', 'app-1') as unknown as Promise<{ data: Array<{ client_password: string }> }>);
  assert.equal(data[0].client_password, 'hash-vecchio', 'nessuna password inviata -> nessuna modifica alla password esistente');
});
