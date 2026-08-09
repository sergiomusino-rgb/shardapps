// ─── Test End-to-End del webhook Stripe (ultimo tassello, Fase 3B) ─────────
// node:test built-in, nessuna dipendenza nuova, nessuna chiamata di rete/DB
// reale, nessuna chiave Stripe reale. Chiama direttamente
// handleStripeWebhookEvent(supabase, stripe, event) (lib/stripe-webhook-
// handler.js) con un client Supabase finto (in-memory, definito sotto) e uno
// stub Stripe minimale — bypassa Express/HTTP e la verifica firma (già
// testata isolatamente in stripe-webhook-logic.test.js), per concentrarsi
// sul comportamento end-to-end della logica di business a valle di essa:
// scritture DB, idempotenza, guardia anti-eventi-fuori-ordine.
//
// Uso: node --test lib (dalla cartella backend/), o npm test.

const test = require('node:test');
const assert = require('node:assert/strict');

const { handleStripeWebhookEvent } = require('./stripe-webhook-handler');

// ─── Fake Supabase client in-memory ─────────────────────────────────────────
// Copre solo la superficie usata dall'handler: .from(table).select().eq()
// .single()/.maybeSingle()/.insert()/.update()/.upsert(), più .rpc(). Ogni
// tabella è una Map di righe keyed by id (o da una unique key sintetica per
// processed_checkout_sessions, per riprodurre il vincolo UNIQUE(session_id)
// che isDuplicateSessionError si aspetta di veder violato).
function createFakeSupabase(seed = {}) {
  const db = {
    tenants: new Map(),
    apps: new Map(),
    subscriptions: new Map(), // keyed by tenant_id (onConflict: 'tenant_id')
    processed_checkout_sessions: new Map(), // keyed by session_id (UNIQUE)
    ...Object.fromEntries(Object.entries(seed).map(([table, rows]) => [table, new Map(rows)])),
  };

  function matchesFilters(row, filters) {
    return filters.every(([col, val]) => row[col] === val);
  }

  function queryBuilder(table) {
    const filters = [];
    let selectCols = null;

    const builder = {
      select(cols) {
        selectCols = cols;
        return builder;
      },
      eq(col, val) {
        filters.push([col, val]);
        return builder;
      },
      async single() {
        const rows = [...db[table].values()].filter(r => matchesFilters(r, filters));
        if (rows.length !== 1) return { data: null, error: { message: 'not found or not unique' } };
        return { data: rows[0], error: null };
      },
      async maybeSingle() {
        const rows = [...db[table].values()].filter(r => matchesFilters(r, filters));
        if (rows.length === 0) return { data: null, error: null };
        return { data: rows[0], error: null };
      },
      async insert(row) {
        // Riproduce il vincolo UNIQUE(session_id) su processed_checkout_sessions:
        // stessa chiave -> errore Postgres 23505 (isDuplicateSessionError).
        if (table === 'processed_checkout_sessions') {
          if (db[table].has(row.session_id)) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          }
          db[table].set(row.session_id, { ...row });
          return { data: row, error: null };
        }
        const key = row.id || `${table}-${db[table].size + 1}`;
        db[table].set(key, { id: key, ...row });
        return { data: row, error: null };
      },
      update(patch) {
        return {
          async eq(col, val) {
            let updated = 0;
            for (const [key, row] of db[table].entries()) {
              if (row[col] === val) {
                db[table].set(key, { ...row, ...patch });
                updated++;
              }
            }
            return { data: null, error: updated > 0 ? null : null };
          },
          eq2: null, // placeholder non usato: eq().eq() è gestito sotto per i casi a doppio filtro
        };
      },
      async upsert(row, opts) {
        const conflictCol = opts?.onConflict || 'id';
        const key = conflictCol === 'tenant_id' ? row.tenant_id : (row.id || `${table}-${db[table].size + 1}`);
        const existing = db[table].get(key) || {};
        db[table].set(key, { ...existing, ...row });
        return { data: row, error: null };
      },
    };
    return builder;
  }

  // update().eq().eq() (usato da invoice.payment_failed / subscription.deleted
  // per filtrare sia su tenant_id sia su stripe_subscription_id): il builder
  // sopra copre solo un singolo .eq() dopo update(). Per questi due case
  // specifici basta il primo .eq(tenant_id, ...) — è il filtro che decide
  // quale riga aggiornare nei nostri dati di test — quindi il secondo .eq()
  // viene reso chainable ma no-op qui sotto tramite un Proxy minimale.
  function wrapUpdateChain(table, patch) {
    let firstFilterApplied = false;
    let filters = [];
    const chain = {
      eq(col, val) {
        filters.push([col, val]);
        // Esegue l'update solo alla fine della catena (dopo tutti gli .eq()),
        // ma per semplicità qui applichiamo subito e ogni ulteriore .eq()
        // semplicemente ri-filtra sulle righe già aggiornate (comportamento
        // equivalente per i nostri scenari, dove i due filtri individuano la
        // stessa riga univocamente).
        if (!firstFilterApplied) {
          firstFilterApplied = true;
          for (const [key, row] of db[table].entries()) {
            if (matchesFilters(row, filters)) {
              db[table].set(key, { ...row, ...patch });
            }
          }
        }
        return chain;
      },
      then(resolve) {
        resolve({ data: null, error: null });
      },
    };
    return chain;
  }

  const supabase = {
    from(table) {
      const qb = queryBuilder(table);
      // Sovrascrive update per supportare .update(patch).eq().eq() con la
      // versione a catena completa sopra.
      qb.update = (patch) => wrapUpdateChain(table, patch);
      return qb;
    },
    async rpc(fnName, _args) {
      // add_tenant_slots / grant_credits: nei test E2E interessa solo che
      // vengano chiamate senza errore, non il loro effetto (sono funzioni
      // Postgres, fuori dallo scope di questo handler).
      return { data: null, error: null };
    },
    _db: db, // esposto per le asserzioni nei test
  };

  return supabase;
}

// ─── Stub Stripe minimale ────────────────────────────────────────────────
// Copre solo stripe.subscriptions.create, l'unica chiamata Stripe raggiunta
// dagli scenari sotto: resolvePlanFromSession fa short-circuit su
// metadata.plan_id (già presente in tutti gli eventi di test) senza toccare
// checkout.sessions.listLineItems/prices.retrieve/products.retrieve.
function createFakeStripe({ failFeeSubscriptionCreate = false } = {}) {
  let created = [];
  return {
    subscriptions: {
      async create(params) {
        if (failFeeSubscriptionCreate) throw new Error('stub: creazione fee subscription fallita');
        const sub = {
          id: `sub_fee_${created.length + 1}`,
          status: 'active',
          customer: params.customer,
          items: { data: [{ current_period_start: 1700000000, current_period_end: 1702592000 }] },
        };
        created.push(sub);
        return sub;
      },
    },
    _created: created,
  };
}

function makeCheckoutSessionEvent({ id = 'cs_test_1', metadata = {}, customer = 'cus_test_1', customerEmail = 'cliente@example.com', created = 1700000000, subscription = null } = {}) {
  return {
    type: 'checkout.session.completed',
    created,
    data: {
      object: {
        id,
        customer,
        customer_email: customerEmail,
        customer_details: { email: customerEmail },
        payment_intent: `pi_${id}`,
        subscription,
        metadata,
        client_reference_id: metadata.tenant_id || null,
      },
    },
  };
}

// ─── Scenario 1: Reseller — checkout.session.completed con metadata.tenant_id/plan_id ─
test('E2E reseller: checkout.session.completed applica plan/slot al tenant e crea la fee subscription', async () => {
  const supabase = createFakeSupabase({
    tenants: [['tenant-1', { id: 'tenant-1', plan: 'free' }]],
  });
  const stripe = createFakeStripe();

  const event = makeCheckoutSessionEvent({
    id: 'cs_reseller_1',
    metadata: { tenant_id: 'tenant-1', plan_id: 'pro', supabase_user_id: 'user-1' },
  });

  await handleStripeWebhookEvent(supabase, stripe, event);

  const tenant = supabase._db.tenants.get('tenant-1');
  assert.equal(tenant.plan, 'pro', 'il piano del tenant deve essere aggiornato a pro');

  const processed = supabase._db.processed_checkout_sessions.get('cs_reseller_1');
  assert.ok(processed, 'la sessione deve essere registrata come processata (idempotenza)');
  assert.equal(processed.plan, 'pro');
  assert.equal(processed.slots_added, 5, 'PLAN_SLOTS.pro = 5');

  const sub = supabase._db.subscriptions.get('tenant-1');
  assert.ok(sub, 'deve essere stata creata la fee subscription per il tenant');
  assert.equal(sub.stripe_subscription_id, 'sub_fee_1');
  assert.equal(stripe._created.length, 1, 'stripe.subscriptions.create va chiamato esattamente una volta');
});

// ─── Scenario 2: App-client — checkout.session.completed con metadata.app_id ──
test('E2E app-client: checkout.session.completed attiva la app e scrive stripe_event_applied_at', async () => {
  const supabase = createFakeSupabase({
    apps: [['app-1', { id: 'app-1', status: 'trialing', stripe_event_applied_at: null }]],
  });
  const stripe = createFakeStripe();

  const event = makeCheckoutSessionEvent({
    id: 'cs_app_1',
    metadata: { app_id: 'app-1' },
    subscription: 'sub_app_1',
    created: 1700000500,
  });

  await handleStripeWebhookEvent(supabase, stripe, event);

  const app = supabase._db.apps.get('app-1');
  assert.equal(app.status, 'active', 'la app deve passare a active');
  assert.equal(app.stripe_subscription_id, 'sub_app_1');
  assert.equal(
    app.stripe_event_applied_at,
    new Date(1700000500 * 1000).toISOString(),
    'stripe_event_applied_at deve riflettere il campo created dell\'evento, non un timestamp arbitrario'
  );

  // Il ramo app NON deve toccare tenants/subscriptions (nessuna fee
  // subscription creata: è un abbonamento app-cliente, non reseller).
  assert.equal(stripe._created.length, 0);
  assert.equal(supabase._db.subscriptions.size, 0);
});

// ─── Scenario 3a: idempotenza — stesso evento checkout.session.completed applicato due volte ──
test('E2E idempotenza: rielaborare lo stesso checkout.session.completed non somma slot/crediti due volte', async () => {
  const supabase = createFakeSupabase({
    tenants: [['tenant-2', { id: 'tenant-2', plan: 'free' }]],
  });
  const stripe = createFakeStripe();

  const event = makeCheckoutSessionEvent({
    id: 'cs_dup_1',
    metadata: { tenant_id: 'tenant-2', plan_id: 'starter', supabase_user_id: 'user-2' },
  });

  await handleStripeWebhookEvent(supabase, stripe, event);
  const afterFirst = supabase._db.processed_checkout_sessions.get('cs_dup_1');
  assert.ok(afterFirst);

  // Stripe re-invia lo stesso evento (retry/duplicato): stessa sessionId.
  await handleStripeWebhookEvent(supabase, stripe, event);

  // La seconda applicazione deve essere no-op: solo una fee subscription
  // creata (non due), un solo record processed_checkout_sessions.
  assert.equal(stripe._created.length, 1, 'la fee subscription va creata una sola volta, non ad ogni retry');
  assert.equal(supabase._db.tenants.get('tenant-2').plan, 'starter');
});

// ─── Scenario 3b: staleness — evento fuori ordine su apps.status viene scartato ──
test('E2E staleness: un evento app-client più vecchio dell\'ultimo applicato viene ignorato (isStaleEvent)', async () => {
  const appliedAt = 1700001000; // evento "recente" già applicato
  const supabase = createFakeSupabase({
    apps: [['app-2', {
      id: 'app-2',
      status: 'active',
      stripe_event_applied_at: new Date(appliedAt * 1000).toISOString(),
    }]],
  });
  const stripe = createFakeStripe();

  // Evento invoice.payment_failed con created PRECEDENTE all'ultimo applicato:
  // deve essere trattato come fuori ordine e scartato, non deve retrocedere
  // lo stato della app da active a past_due.
  const staleEvent = {
    type: 'invoice.payment_failed',
    created: appliedAt - 500, // più vecchio
    data: {
      object: {
        subscription: 'sub_app_2',
        customer: 'cus_app_2',
      },
    },
  };

  // getAppIdBySubscriptionId cerca per stripe_subscription_id: la app di
  // test deve averlo popolato per essere trovata dal lookup.
  supabase._db.apps.set('app-2', { ...supabase._db.apps.get('app-2'), stripe_subscription_id: 'sub_app_2' });

  await handleStripeWebhookEvent(supabase, stripe, staleEvent);

  const app = supabase._db.apps.get('app-2');
  assert.equal(app.status, 'active', 'lo stato non deve regredire: l\'evento fuori ordine va scartato');
  assert.equal(
    app.stripe_event_applied_at,
    new Date(appliedAt * 1000).toISOString(),
    'stripe_event_applied_at non deve essere toccato da un evento scartato come stale'
  );
});

// ─── Scenario 3c: staleness — evento più recente viene invece applicato ────
test('E2E staleness: un evento app-client più recente dell\'ultimo applicato aggiorna lo stato normalmente', async () => {
  const appliedAt = 1700001000;
  const supabase = createFakeSupabase({
    apps: [['app-3', {
      id: 'app-3',
      status: 'active',
      stripe_event_applied_at: new Date(appliedAt * 1000).toISOString(),
      stripe_subscription_id: 'sub_app_3',
    }]],
  });
  const stripe = createFakeStripe();

  const freshEvent = {
    type: 'invoice.payment_failed',
    created: appliedAt + 500, // più recente
    data: {
      object: {
        subscription: 'sub_app_3',
        customer: 'cus_app_3',
      },
    },
  };

  await handleStripeWebhookEvent(supabase, stripe, freshEvent);

  const app = supabase._db.apps.get('app-3');
  assert.equal(app.status, 'past_due', 'un evento più recente deve essere applicato normalmente');
});

// ─── Scenario 4: "Ricarica Extra" (credit_topup) — idempotenza su payment_intent ──
test('E2E credit_topup: checkout.session.completed usa payment_intent come chiave di idempotenza', async () => {
  const supabase = createFakeSupabase({
    tenants: [['tenant-3', { id: 'tenant-3', plan: 'starter' }]],
  });
  const stripe = createFakeStripe();

  const event = makeCheckoutSessionEvent({
    id: 'cs_topup_1',
    metadata: { tenant_id: 'tenant-3', plan_id: 'credit_topup', quantity: '2', supabase_user_id: 'user-3' },
  });

  await handleStripeWebhookEvent(supabase, stripe, event);

  const processed = supabase._db.processed_checkout_sessions.get(`pi_cs_topup_1`);
  assert.ok(processed, 'la chiave di idempotenza deve essere il payment_intent, non session.id');
  assert.equal(processed.slots_added, 2, 'PLAN_SLOTS.credit_topup(1) * quantity(2) = 2');

  // Il piano del tenant non deve cambiare per una ricarica extra.
  assert.equal(supabase._db.tenants.get('tenant-3').plan, 'starter');
  // Nessuna fee subscription per un topup di crediti.
  assert.equal(stripe._created.length, 0);
});
