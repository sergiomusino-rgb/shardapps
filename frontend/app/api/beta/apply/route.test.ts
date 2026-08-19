// ─── Test HTTP — POST /api/beta/apply ───────────────────────────────────────
// Fase 1B: persistenza reale delle candidature Private Beta in
// beta_applications (RLS deny-all — solo questa route, service role, può
// scrivere). Stesso harness delle altre route (route-test-harness.ts):
// importa la route REALE con un fake Supabase in-memory al posto di
// '@supabase/supabase-js', nessuna riscrittura del codice di produzione.
//
// Uso: node --test "app/api/beta/apply/route.test.ts" (da frontend/).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupRouteTest, importRoute } from '../../../../src/lib/test-helpers/route-test-harness.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const ROUTE_PATH = 'app/api/beta/apply/route.ts';

// ─── Nota sul rate limit nei test di QUESTO file ───────────────────────────
// src/lib/rate-limit.ts tiene il client Supabase admin in un singleton di
// MODULO (getAdminClient(), mai resettato) — voluto in produzione (un solo
// progetto Supabase reale, nessun motivo di ricrearlo ad ogni richiesta).
// Nei test però questo significa che la PRIMISSIMA chiamata a
// checkRateLimit() di TUTTO il file cattura per sempre l'istanza fake attiva
// in quel momento: i rpcHandlers passati dai setupRouteTest() dei test
// successivi non vengono più letti da quella chiamata, perché
// getAdminClient() continua a riusare il client catturato la prima volta
// (a differenza di supabaseAdmin dentro route.ts, che invece è sempre
// fresco: importRoute() re-importa la route con un URL cache-bustato ad
// ogni test, rate-limit.ts no). Per questo il comportamento di
// check_rate_limit per l'intero file è pilotato da questa variabile
// condivisa, letta dalla stessa closure indipendentemente da quale test
// l'ha effettivamente "vinta" — non dai singoli rpcHandlers per-test.
let rateLimitAllowed = true;

function setup(t: Parameters<typeof setupRouteTest>[0], opts: Parameters<typeof setupRouteTest>[1] = {}) {
  return setupRouteTest(t, {
    ...opts,
    rpcHandlers: {
      check_rate_limit: () => ({
        data: [{ allowed: rateLimitAllowed, remaining: rateLimitAllowed ? 4 : 0 }],
        error: null,
      }),
      ...(opts.rpcHandlers || {}),
    },
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    full_name: 'Mario Rossi',
    company_name: 'Rossi Digital Agency',
    email: 'mario@rossidigital.it',
    website: 'https://rossidigital.it',
    country: 'Italia',
    business_type: 'agency',
    client_count: '1-10',
    app_types: 'Gestionali per ristoranti e negozi al dettaglio.',
    expected_apps: '1-3',
    message: '',
    ...overrides,
  };
}

async function callRoute(body: unknown, rawOverride?: string) {
  const { POST } = await importRoute(ROUTE_PATH);
  const { NextRequest } = await import('next/server.js');
  const req = new NextRequest('http://localhost/api/beta/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: rawOverride !== undefined ? rawOverride : JSON.stringify(body),
  });
  return (POST as (r: Request) => Promise<Response>)(req);
}

test('201: candidatura valida viene salvata in beta_applications', async (t) => {
  const { supabase } = setup(t);

  const res = await callRoute(validBody());
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.code, 'CREATED');
  // Risposta minimale: nessun id/riga restituita al client.
  assert.equal(body.id, undefined);

  const { data: rows } = await supabase
    .from('beta_applications')
    .select('*')
    .eq('email', 'mario@rossidigital.it');
  assert.equal(rows?.length, 1);
  assert.equal(rows?.[0].full_name, 'Mario Rossi');
  assert.equal(rows?.[0].company_name, 'Rossi Digital Agency');
  assert.equal(rows?.[0].business_type, 'agency');
  // La route non imposta mai `status` esplicitamente nell'insert: lo stato
  // iniziale ('new') è responsabilità del DEFAULT di colonna nella
  // migration, non del codice applicativo — qui infatti non compare (il
  // fake non simula i DEFAULT del DB salvo passarli via defaultsByTable).
  assert.equal(rows?.[0].status, undefined);
});

test('400: campo obbligatorio mancante (company_name assente) — nessuna riga creata', async (t) => {
  const { supabase } = setup(t);

  const { company_name, ...withoutCompany } = validBody();
  void company_name;
  const res = await callRoute(withoutCompany);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.code, 'VALIDATION_ERROR');
  assert.ok(body.fields.includes('company_name'));

  const { data: rows } = await supabase.from('beta_applications').select('*');
  assert.equal(rows?.length, 0);
});

test('400: email non valida', async (t) => {
  setup(t);

  const res = await callRoute(validBody({ email: 'non-una-email' }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'VALIDATION_ERROR');
  assert.ok(body.fields.includes('email'));
});

test('400: business_type con un valore fuori dall\'enum ammesso', async (t) => {
  setup(t);

  const res = await callRoute(validBody({ business_type: 'not-a-real-type' }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.fields.includes('business_type'));
});

test('400: payload troppo grande (oltre il limite byte) — rifiutato prima del parse dei singoli campi', async (t) => {
  setup(t);

  const res = await callRoute(validBody({ message: 'x'.repeat(30_000) }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.code, 'PAYLOAD_TOO_LARGE');
});

test('200 ALREADY_APPLIED: stessa email (case-insensitive) non crea una seconda riga', async (t) => {
  const { supabase } = setup(t);

  const first = await callRoute(validBody({ email: 'Mario@RossiDigital.it' }));
  assert.equal(first.status, 201);

  const second = await callRoute(validBody({ email: 'mario@rossidigital.it', full_name: 'Mario Rossi Bis' }));
  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.equal(secondBody.success, true);
  assert.equal(secondBody.code, 'ALREADY_APPLIED');

  const { data: rows } = await supabase.from('beta_applications').select('*');
  assert.equal(rows?.length, 1);
  // La riga originale non viene toccata dal secondo tentativo (nessun
  // update): full_name resta quello della prima candidatura.
  assert.equal(rows?.[0].full_name, 'Mario Rossi');
});

test('500: insert Supabase fallito -> errore generico, nessun dettaglio interno esposto', async (t) => {
  setup(t, {
    forceErrors: { beta_applications: { insert: { message: 'connection reset by peer (dettaglio interno)' } } },
  });

  const res = await callRoute(validBody({ email: 'errore@rossidigital.it' }));
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.code, 'INTERNAL_ERROR');
  assert.ok(!JSON.stringify(body).includes('connection reset by peer'));
});

test('429: rate limit superato', async (t) => {
  setup(t);
  rateLimitAllowed = false;
  t.after(() => {
    rateLimitAllowed = true;
  });

  const res = await callRoute(validBody());
  assert.equal(res.status, 429);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.code, 'RATE_LIMITED');
});

test('400: JSON non valido nel body', async (t) => {
  setup(t);

  const res = await callRoute(undefined, '{not-json');
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'INVALID_JSON');
});

// ─── Nessuna service role key esposta al browser ───────────────────────────
// BetaApplicationForm.tsx è 'use client' (bundlato nel browser): deve
// limitarsi a fare fetch('/api/beta/apply') e non referenziare mai la
// service role key o crearsi un proprio client Supabase con privilegi
// elevati. Verifica statica del sorgente, non un test HTTP.
test('BetaApplicationForm.tsx non referenzia mai la service role key', () => {
  const formSource = fs.readFileSync(path.resolve(HERE, '../../../beta/BetaApplicationForm.tsx'), 'utf8');
  assert.ok(!/SERVICE_ROLE/i.test(formSource));
  assert.ok(!/createClient/.test(formSource)); // nessun client Supabase proprio: solo fetch() verso la route
});
