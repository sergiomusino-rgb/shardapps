// ─── Test HTTP — POST /api/a/[slug]/verify-password (Pre-Beta Hardening, Blocco 6) ──
// Verifica il confronto hash-aware + rehash-on-verify a livello di route
// reale (non solo il modulo password-hash.ts isolato, già coperto a parte).
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupRouteTest, importRoute } from '../../../../../src/lib/test-helpers/route-test-harness.ts';
import { hashPassword } from '../../../../../src/lib/password-hash.ts';

const ROUTE_PATH = 'app/api/a/[slug]/verify-password/route.ts';

async function callRoute(slug: string, password: string) {
  const { POST } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest(`http://localhost/api/a/${slug}/verify-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  return (POST as (r: Request, ctx: { params: Promise<{ slug: string }> }) => Promise<Response>)(
    req, { params: Promise.resolve({ slug }) }
  );
}

test('200: password corretta contro un hash reale già migrato -> autorizzato', async (t) => {
  const hash = await hashPassword('Segreta123');
  setupRouteTest(t, {
    seedTables: {
      apps: [{ id: 'app-1', slug: 'ristorante-rossi', client_active: true, config: { appName: 'Ristorante Rossi' } }],
      app_credentials: [{ app_id: 'app-1', client_password: hash }],
    },
  });
  const res = await callRoute('ristorante-rossi', 'Segreta123');
  assert.equal(res.status, 200);
});

test('401: password errata contro un hash reale', async (t) => {
  const hash = await hashPassword('Segreta123');
  setupRouteTest(t, {
    seedTables: {
      apps: [{ id: 'app-1', slug: 'ristorante-rossi', client_active: true, config: {} }],
      app_credentials: [{ app_id: 'app-1', client_password: hash }],
    },
  });
  const res = await callRoute('ristorante-rossi', 'password-sbagliata');
  assert.equal(res.status, 401);
});

test('migrazione legacy: account con password ancora in chiaro -> 200 E rehash immediato in app_credentials', async (t) => {
  const { supabase } = setupRouteTest(t, {
    seedTables: {
      apps: [{ id: 'app-1', slug: 'officina-verdi', client_active: true, config: {} }],
      app_credentials: [{ app_id: 'app-1', client_password: 'vecchia-in-chiaro' }],
    },
  });
  const res = await callRoute('officina-verdi', 'vecchia-in-chiaro');
  assert.equal(res.status, 200);

  const { data } = await supabase.from('app_credentials').select('*').eq('app_id', 'app-1');
  const stored = (data as Array<{ client_password: string }>)[0].client_password;
  assert.notEqual(stored, 'vecchia-in-chiaro', 'la password in chiaro non deve più esistere dopo il login');
  assert.match(stored, /^\$2[aby]\$/, 'sostituita da un hash bcrypt reale');
});

test('migrazione legacy: un secondo login con la stessa password continua a funzionare dopo il rehash', async (t) => {
  const { supabase } = setupRouteTest(t, {
    seedTables: {
      apps: [{ id: 'app-1', slug: 'pizzeria-bianchi', client_active: true, config: {} }],
      app_credentials: [{ app_id: 'app-1', client_password: 'chiaro-iniziale' }],
    },
  });
  const first = await callRoute('pizzeria-bianchi', 'chiaro-iniziale');
  assert.equal(first.status, 200);

  // Il fake supabase persiste tra le due chiamate nello stesso test (stessa
  // istanza `supabase` restituita da setupRouteTest): il secondo login deve
  // trovare l'hash già scritto dal primo, non più il valore in chiaro.
  const second = await callRoute('pizzeria-bianchi', 'chiaro-iniziale');
  assert.equal(second.status, 200);

  const { data } = await supabase.from('app_credentials').select('*').eq('app_id', 'app-1');
  assert.match((data as Array<{ client_password: string }>)[0].client_password, /^\$2[aby]\$/);
});

test('app bloccata: 403 prima ancora di verificare la password', async (t) => {
  setupRouteTest(t, {
    seedTables: {
      apps: [{ id: 'app-1', slug: 'bar-neri', client_active: false, config: {} }],
      app_credentials: [{ app_id: 'app-1', client_password: await hashPassword('qualunque') }],
    },
  });
  const res = await callRoute('bar-neri', 'qualunque');
  assert.equal(res.status, 403);
});
