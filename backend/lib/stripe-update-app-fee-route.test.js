// ─── Test E2E di POST /api/update-app-fee (STEP 4 — App Catalog billing) ───
// node:test built-in, nessuna dipendenza nuova, nessuna chiamata di
// rete/DB/Stripe reale. Stesso seam/pattern di stripe-sync-plan-route.test.js
// (router.__setTestClients + handler estratto da router.stack): la route
// costruisce supabase/stripe internamente, quindi va iniettato un client
// finto invece di poter chiamare handleXyz(supabase, stripe, ...) come per
// il webhook.
//
// Oggetto del test: il filtro `.is('product_id', null)` aggiunto al
// conteggio app di /update-app-fee (STEP 4, per non doppio-fatturare una
// Catalog Instance sia nella fee reseller per-app sia nella sua subscription
// Stripe diretta) — verifica che una Catalog Instance scaduta di trial NON
// venga contata, mentre un'app normale nello stesso identico stato lo sia
// ancora (comportamento preesistente, invariato).
//
// Uso: node --test lib (dalla cartella backend/), o npm test.

const test = require('node:test');
const assert = require('node:assert/strict');

const router = require('../routes/stripe');

function getUpdateAppFeeHandler() {
  const layer = router.stack.find((l) => l.route && l.route.path === '/update-app-fee' && l.route.methods.post);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
const updateAppFeeHandler = getUpdateAppFeeHandler();

process.env.BACKEND_SERVICE_TOKEN = 'test-service-token';

function makeReq({ userId = 'user-1', tenantId = 'tenant-1', action = 'decrement' } = {}) {
  return {
    headers: {
      authorization: 'Bearer test-service-token',
      'x-user-id': userId,
    },
    body: { tenantId, action },
  };
}

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

// ─── Fake Supabase: query builder generico a filtri accumulati ────────────
// Copre solo la superficie usata da /update-app-fee: .select(cols, opts?)
// .eq()/.neq()/.is()/.not()/.lt(), risolto come Promise (il builder stesso è
// thenable) in tre forme — count (select con {count:'exact',head:true}),
// single(), o lista grezza. Sufficiente per questo endpoint, non un ORM.
function createFakeSupabase(seed = {}) {
  const db = {
    tenant_members: new Map(),
    subscriptions: new Map(),
    apps: new Map(),
    ...Object.fromEntries(Object.entries(seed).map(([t, rows]) => [t, new Map(rows)])),
  };

  function queryBuilder(table) {
    const predicates = [];
    let countMode = false;
    let singleMode = null;

    const builder = {
      select(_cols, opts) {
        if (opts && opts.count === 'exact' && opts.head) countMode = true;
        return builder;
      },
      eq(col, val) { predicates.push((r) => r[col] === val); return builder; },
      neq(col, val) { predicates.push((r) => r[col] !== val); return builder; },
      is(col, val) {
        predicates.push((r) => (val === null ? (r[col] === null || r[col] === undefined) : r[col] === val));
        return builder;
      },
      not(col, op, val) {
        if (op === 'is' && val === null) {
          predicates.push((r) => r[col] !== null && r[col] !== undefined);
          return builder;
        }
        throw new Error(`fake .not() non supporta questa combinazione: ${op} ${val}`);
      },
      lt(col, val) { predicates.push((r) => r[col] != null && r[col] < val); return builder; },
      single() { singleMode = 'single'; return builder; },
      maybeSingle() { singleMode = 'maybeSingle'; return builder; },
      then(resolve) {
        const rows = [...db[table].values()].filter((r) => predicates.every((p) => p(r)));
        if (countMode) { resolve({ count: rows.length, data: null, error: null }); return; }
        if (singleMode === 'single') {
          if (rows.length !== 1) { resolve({ data: null, error: { message: 'not found or not unique' } }); return; }
          resolve({ data: rows[0], error: null });
          return;
        }
        if (singleMode === 'maybeSingle') { resolve({ data: rows[0] || null, error: null }); return; }
        resolve({ data: rows, error: null });
      },
    };
    return builder;
  }

  return { from: (table) => queryBuilder(table) };
}

function createFakeStripe() {
  const updates = [];
  return {
    subscriptions: {
      async retrieve(id) {
        return {
          id,
          items: {
            data: [{ id: 'si_fee_1', price: { metadata: { type: 'app_fee' } }, quantity: 0 }],
          },
        };
      },
      async update(id, patch) {
        updates.push({ id, patch });
        return { id, ...patch };
      },
    },
    _updates: updates,
  };
}

const NOW = new Date();
const TRIAL_EXPIRED = new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString(); // ieri, scaduto

test('STEP4: una Catalog Instance (product_id valorizzato) con trial owner scaduto NON viene contata nella fee reseller', async () => {
  const supabase = createFakeSupabase({
    tenant_members: [['tm-1', { tenant_id: 'tenant-1', user_id: 'user-1' }]],
    subscriptions: [['sub-1', { tenant_id: 'tenant-1', stripe_subscription_id: 'sub_fee_1' }]],
    apps: [
      // App normale, non-Catalog: DEVE essere contata (comportamento
      // preesistente, invariato).
      ['app-legacy', { id: 'app-legacy', tenant_id: 'tenant-1', status: 'trial', product_id: null, owner_trial_ends_at: TRIAL_EXPIRED }],
      // Catalog Instance nello stesso identico stato: NON deve essere
      // contata, ha (o avrà) una propria subscription Stripe diretta.
      ['app-catalog', { id: 'app-catalog', tenant_id: 'tenant-1', status: 'trial', product_id: 'product-1', owner_trial_ends_at: TRIAL_EXPIRED }],
    ],
  });
  const stripe = createFakeStripe();
  router.__setTestClients({ supabase, stripe });

  const req = makeReq({ tenantId: 'tenant-1', action: 'decrement' });
  const res = makeRes();
  await updateAppFeeHandler(req, res);

  router.__setTestClients({}); // reset, non deve trapelare in altri test

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.newQuantity, 1, 'solo app-legacy deve contare: 1, non 2');
  assert.equal(stripe._updates.length, 1);
  assert.equal(stripe._updates[0].patch.items[0].quantity, 1);
});

test('STEP4: due Catalog Instance scadute e nessuna app legacy -> quantity 0 (nessuna doppia fatturazione)', async () => {
  const supabase = createFakeSupabase({
    tenant_members: [['tm-2', { tenant_id: 'tenant-2', user_id: 'user-2' }]],
    subscriptions: [['sub-2', { tenant_id: 'tenant-2', stripe_subscription_id: 'sub_fee_2' }]],
    apps: [
      ['app-catalog-a', { id: 'app-catalog-a', tenant_id: 'tenant-2', status: 'trial', product_id: 'product-1', owner_trial_ends_at: TRIAL_EXPIRED }],
      ['app-catalog-b', { id: 'app-catalog-b', tenant_id: 'tenant-2', status: 'past_due', product_id: 'product-2', owner_trial_ends_at: TRIAL_EXPIRED }],
    ],
  });
  const stripe = createFakeStripe();
  router.__setTestClients({ supabase, stripe });

  const req = makeReq({ userId: 'user-2', tenantId: 'tenant-2', action: 'decrement' });
  const res = makeRes();
  await updateAppFeeHandler(req, res);

  router.__setTestClients({});

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.newQuantity, 0, 'nessuna app non-Catalog scaduta: la fee reseller resta a 0');
});

test('STEP4: una Catalog Instance già status=active (pagante direttamente) non viene comunque mai contata', async () => {
  const supabase = createFakeSupabase({
    tenant_members: [['tm-3', { tenant_id: 'tenant-3', user_id: 'user-3' }]],
    subscriptions: [['sub-3', { tenant_id: 'tenant-3', stripe_subscription_id: 'sub_fee_3' }]],
    apps: [
      ['app-catalog-active', { id: 'app-catalog-active', tenant_id: 'tenant-3', status: 'active', product_id: 'product-1', owner_trial_ends_at: TRIAL_EXPIRED }],
    ],
  });
  const stripe = createFakeStripe();
  router.__setTestClients({ supabase, stripe });

  const req = makeReq({ userId: 'user-3', tenantId: 'tenant-3', action: 'decrement' });
  const res = makeRes();
  await updateAppFeeHandler(req, res);

  router.__setTestClients({});

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.newQuantity, 0, 'già esclusa da neq(status,\'active\') comunque: doppia garanzia con il filtro product_id');
});
