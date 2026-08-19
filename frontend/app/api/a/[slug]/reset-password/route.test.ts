// ─── Test HTTP — POST /api/a/[slug]/reset-password ─────────────────────────
// (Notifications, Pre-Beta Hardening Round 2 — refactor verso src/lib/email.ts)
// RESEND_API_KEY resta assente in questo ambiente di test: sendTemplatedEmail
// arriva fino al tentativo di invio e si ferma lì (skipped), nessuna vera
// chiamata di rete — stesso identico principio già in uso in
// verify-password/route.test.ts per le altre route "silenziose per design".
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupRouteTest, importRoute } from '../../../../../src/lib/test-helpers/route-test-harness.ts';

const ROUTE_PATH = 'app/api/a/[slug]/reset-password/route.ts';

async function callRoute(slug: string, email: unknown) {
  const { POST } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest(`http://localhost/api/a/${slug}/reset-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return (POST as (r: Request, ctx: { params: Promise<{ slug: string }> }) => Promise<Response>)(
    req, { params: Promise.resolve({ slug }) }
  );
}

test('200: email corrispondente su un\'app attiva -> risposta generica di successo, token creato', async (t) => {
  const { supabase } = setupRouteTest(t, {
    seedTables: {
      apps: [{ id: 'app-1', slug: 'ristorante-rossi', name: 'Ristorante Rossi', client_email: 'cliente@esempio.it', client_active: true }],
      app_password_reset_tokens: [],
    },
  });
  const res = await callRoute('ristorante-rossi', 'cliente@esempio.it');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);

  const { data: tokens } = await supabase.from('app_password_reset_tokens').select('*').eq('app_id', 'app-1');
  assert.equal((tokens || []).length, 1, 'un token di reset è stato creato realmente');
});

test('200 generico anche con email NON corrispondente (mai un oracle su quale email è registrata)', async (t) => {
  const { supabase } = setupRouteTest(t, {
    seedTables: {
      apps: [{ id: 'app-1', slug: 'ristorante-rossi', client_email: 'cliente@esempio.it', client_active: true }],
      app_password_reset_tokens: [],
    },
  });
  const res = await callRoute('ristorante-rossi', 'sbagliata@esempio.it');
  assert.equal(res.status, 200);
  const { data: tokens } = await supabase.from('app_password_reset_tokens').select('*');
  assert.equal((tokens || []).length, 0, 'nessun token creato per un\'email non corrispondente');
});

test('200 generico anche per uno slug inesistente (mai un oracle su quali slug esistono)', async (t) => {
  setupRouteTest(t, { seedTables: { apps: [] } });
  const res = await callRoute('non-esiste', 'chiunque@esempio.it');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
});

test('200 generico su un\'app bloccata (client_active=false), nessun token creato', async (t) => {
  const { supabase } = setupRouteTest(t, {
    seedTables: {
      apps: [{ id: 'app-1', slug: 'ristorante-rossi', client_email: 'cliente@esempio.it', client_active: false }],
      app_password_reset_tokens: [],
    },
  });
  const res = await callRoute('ristorante-rossi', 'cliente@esempio.it');
  assert.equal(res.status, 200);
  const { data: tokens } = await supabase.from('app_password_reset_tokens').select('*');
  assert.equal((tokens || []).length, 0);
});

test('400: email mancante nel body', async (t) => {
  setupRouteTest(t, { seedTables: { apps: [] } });
  const res = await callRoute('qualunque', undefined);
  assert.equal(res.status, 400);
});
