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

const { handleStripeWebhookEvent, getFeePriceId } = require('./stripe-webhook-handler');

// ─── Mutex per-chiave ────────────────────────────────────────────────────
// Riproduce, lato fake, la garanzia che in Postgres dà gratis il vincolo
// UNIQUE su processed_checkout_sessions(session_id): una seconda esecuzione
// di apply_checkout_session_atomic per la STESSA session_id si blocca finché
// la prima non è terminata (successo o rollback), invece di poter
// interleave a metà. Senza questo mutex, il fake sotto — che fa passi
// asincroni reali (grantCreditsImpl può essere async) — potrebbe far
// eseguire due chiamate concorrenti "a cavallo" l'una dell'altra e mascherare
// esattamente la race condition che il Caso 5 deve verificare non esista.
function createKeyedMutex() {
  const tail = new Map(); // key -> promise dell'ultima esecuzione in coda
  return function withLock(key, fn) {
    const prev = tail.get(key) || Promise.resolve();
    const run = prev.then(fn, fn); // esegue fn dopo prev, indipendentemente dal suo esito
    // In coda anche se fn rigetta: altrimenti un'esecuzione fallita
    // lascerebbe la lock "sporca" e la successiva partirebbe comunque dopo
    // la promise rigettata (comportamento corretto), ma serve evitare che
    // un reject non gestito nella catena `tail` faccia esplodere un altro
    // ramo — .catch(() => {}) qui è solo per tenere pulita la catena interna,
    // il risultato/errore vero viene comunque ritornato/propagato da `run`.
    tail.set(key, run.catch(() => {}));
    return run;
  };
}

// ─── Fake Supabase client in-memory ─────────────────────────────────────────
// Copre solo la superficie usata dall'handler: .from(table).select().eq()
// .single()/.maybeSingle()/.insert()/.update()/.upsert(), più .rpc(). Ogni
// tabella è una Map di righe keyed by id (o da una unique key sintetica per
// processed_checkout_sessions, per riprodurre il vincolo UNIQUE(session_id)
// che isDuplicateSessionError si aspetta di veder violato).
//
// `options.grantCreditsImpl(ctx)`: sostituisce il comportamento di
// grant_credits() dentro la simulazione di apply_checkout_session_atomic
// (RPC introdotta dal fix di consistenza crediti Vision, 2026-08-11, vedi
// supabase/migrations/20260811000000_atomic_checkout_session_processing.sql).
// Di default ha sempre successo; i test sui casi 2/3/5 lo sovrascrivono per
// simulare un fallimento (una tantum o permanente). Ritorna `{ error }` per
// far fallire il "passo crediti" oppure un valore qualunque per farlo
// riuscire — stesso contratto di `supabase.rpc('grant_credits', ...)`.
function createFakeSupabase(seed = {}, options = {}) {
  const db = {
    tenants: new Map(),
    apps: new Map(),
    subscriptions: new Map(), // keyed by tenant_id (onConflict: 'tenant_id')
    processed_checkout_sessions: new Map(), // keyed by session_id (UNIQUE)
    ...Object.fromEntries(Object.entries(seed).map(([table, rows]) => [table, new Map(rows)])),
  };

  const grantCreditsImpl = options.grantCreditsImpl || (async () => ({ ok: true }));
  const withSessionLock = createKeyedMutex();
  const creditGrants = []; // { userId, amount, sessionId } — solo quelli effettivamente committati
  const slotGrants = []; // { tenantId, amount } — solo quelli effettivamente committati
  let grantCreditsCallCount = 0;

  // ─── Simulazione di apply_checkout_session_atomic (RPC Postgres reale) ──
  // Replica fedelmente le garanzie della funzione SQL: marca processata +
  // crediti + slot + piano vengono scritti SOLO se ogni passo riesce
  // (nessun effetto collaterale parziale se grant_credits fallisce — stesso
  // "rollback" della transazione reale), e un mutex per-session_id riproduce
  // il blocco della UNIQUE INSERT reale su due esecuzioni concorrenti della
  // stessa sessione (vedi createKeyedMutex sopra).
  function applyCheckoutSessionAtomic(args) {
    return withSessionLock(args.p_session_id, async () => {
      if (db.processed_checkout_sessions.has(args.p_session_id)) {
        return { data: false, error: null }; // già processata: no-op, stesso comportamento di ON CONFLICT DO NOTHING
      }

      if (args.p_credits_to_add > 0 && args.p_user_id) {
        grantCreditsCallCount++;
        const result = await grantCreditsImpl({
          userId: args.p_user_id,
          amount: args.p_credits_to_add,
          sessionId: args.p_session_id,
          callCount: grantCreditsCallCount,
        });
        if (result?.error) {
          // Nessun effetto collaterale scritto: simula il rollback
          // dell'intera transazione Postgres (nessuna riga in
          // processed_checkout_sessions, nessun credito, nessuno slot,
          // nessun aggiornamento piano).
          return { data: null, error: result.error };
        }
        creditGrants.push({ userId: args.p_user_id, amount: args.p_credits_to_add, sessionId: args.p_session_id });
      }

      if (args.p_slots_to_add > 0) {
        slotGrants.push({ tenantId: args.p_tenant_id, amount: args.p_slots_to_add });
      }

      if (args.p_plan) {
        const tenant = db.tenants.get(args.p_tenant_id);
        const rankMap = args.p_plan_rank_map || {};
        const currentRank = rankMap[tenant?.plan] ?? 0;
        const newRank = rankMap[args.p_plan] ?? 0;
        if (newRank >= currentRank) {
          db.tenants.set(args.p_tenant_id, { ...tenant, plan: args.p_plan, updated_at: new Date().toISOString() });
        }
      }

      db.processed_checkout_sessions.set(args.p_session_id, {
        session_id: args.p_session_id,
        tenant_id: args.p_tenant_id,
        plan: args.p_plan || 'credit_topup',
        slots_added: args.p_slots_to_add,
      });

      return { data: true, error: null };
    });
  }

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
    async rpc(fnName, args) {
      if (fnName === 'apply_checkout_session_atomic') {
        return applyCheckoutSessionAtomic(args);
      }
      // Nessun'altra RPC è chiamata da questo handler dopo il fix di
      // consistenza crediti Vision (grant_credits/add_tenant_slots ora
      // vivono SOLO dentro apply_checkout_session_atomic, lato Postgres).
      return { data: null, error: null };
    },
    _db: db, // esposto per le asserzioni nei test
    _creditGrants: creditGrants, // crediti effettivamente committati (non quelli tentati e poi "rollback-ati")
    _slotGrants: slotGrants, // slot effettivamente committati
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

// ─── Consistenza crediti Vision (fix 2026-08-11) ───────────────────────────
// I 6 casi richiesti dal fix di consistenza applyCheckoutSessionOnce ->
// apply_checkout_session_atomic (supabase/migrations/20260811000000_atomic_
// checkout_session_processing.sql). Il fake rpc('apply_checkout_session_
// atomic', ...) in createFakeSupabase replica le garanzie della funzione
// Postgres reale: marcatura+crediti+slot+piano vengono scritti SOLO se ogni
// passo riesce (nessun effetto parziale se grant_credits fallisce), e un
// mutex per-session_id riproduce il blocco della UNIQUE INSERT reale su due
// esecuzioni concorrenti della stessa sessione — vedi commenti su
// createKeyedMutex/applyCheckoutSessionAtomic sopra.

test('Caso 1 — successo: grant_credits riesce, la sessione viene processata e i crediti assegnati una sola volta', async () => {
  const supabase = createFakeSupabase({
    tenants: [['tenant-c1', { id: 'tenant-c1', plan: 'free' }]],
  });
  const stripe = createFakeStripe();
  const event = makeCheckoutSessionEvent({
    id: 'cs_caso1',
    metadata: { tenant_id: 'tenant-c1', plan_id: 'starter', supabase_user_id: 'user-c1' },
  });

  await handleStripeWebhookEvent(supabase, stripe, event);

  assert.ok(supabase._db.processed_checkout_sessions.has('cs_caso1'), 'la sessione deve risultare processata');
  assert.equal(supabase._creditGrants.length, 1, 'i crediti devono essere assegnati esattamente una volta');
  assert.equal(supabase._creditGrants[0].amount, 20, 'PLAN_CREDITS.starter = 20');
  assert.equal(supabase._creditGrants[0].userId, 'user-c1');
  assert.equal(supabase._db.tenants.get('tenant-c1').plan, 'starter');
});

test('Caso 2 — errore crediti: grant_credits fallisce, il webhook deve fallire (throw) e la sessione NON deve restare marcata come processata', async () => {
  const supabase = createFakeSupabase(
    { tenants: [['tenant-c2', { id: 'tenant-c2', plan: 'free' }]] },
    { grantCreditsImpl: async () => ({ error: { message: 'boom: grant_credits fallita' } }) }
  );
  const stripe = createFakeStripe();
  const event = makeCheckoutSessionEvent({
    id: 'cs_caso2',
    metadata: { tenant_id: 'tenant-c2', plan_id: 'starter', supabase_user_id: 'user-c2' },
  });

  // handleStripeWebhookEvent deve propagare l'errore: è quello che fa
  // rispondere 500 a server.js, il segnale che dice a Stripe di ritentare.
  await assert.rejects(() => handleStripeWebhookEvent(supabase, stripe, event));

  assert.equal(
    supabase._db.processed_checkout_sessions.has('cs_caso2'),
    false,
    'la sessione NON deve restare marcata come processata: altrimenti un retry di Stripe la salterebbe per sempre (il bug originale)'
  );
  assert.equal(supabase._creditGrants.length, 0);
  assert.equal(supabase._slotGrants.length, 0, 'nessun effetto parziale: anche gli slot non devono essere stati sommati');
  assert.equal(supabase._db.tenants.get('tenant-c2').plan, 'free', 'il piano non deve essere stato aggiornato');
});

test('Caso 3 — retry dopo errore: il primo tentativo fallisce, il secondo (stesso evento) riesce, crediti assegnati una sola volta', async () => {
  let attempt = 0;
  const supabase = createFakeSupabase(
    { tenants: [['tenant-c3', { id: 'tenant-c3', plan: 'free' }]] },
    {
      grantCreditsImpl: async () => {
        attempt++;
        if (attempt === 1) return { error: { message: 'errore transitorio' } };
        return { ok: true };
      },
    }
  );
  const stripe = createFakeStripe();
  const event = makeCheckoutSessionEvent({
    id: 'cs_caso3',
    metadata: { tenant_id: 'tenant-c3', plan_id: 'starter', supabase_user_id: 'user-c3' },
  });

  await assert.rejects(() => handleStripeWebhookEvent(supabase, stripe, event));
  assert.equal(supabase._db.processed_checkout_sessions.has('cs_caso3'), false);

  // Stripe ritenta la consegna dello stesso evento.
  await handleStripeWebhookEvent(supabase, stripe, event);

  assert.ok(supabase._db.processed_checkout_sessions.has('cs_caso3'));
  assert.equal(supabase._creditGrants.length, 1, 'i crediti devono essere stati assegnati esattamente una volta, non due, nonostante due tentativi');
  assert.equal(attempt, 2, 'grant_credits deve essere stato chiamato due volte (fallito + riuscito)');
});

test('Caso 4 — webhook duplicato: due eventi identici dopo un successo non accreditano due volte', async () => {
  const supabase = createFakeSupabase({
    tenants: [['tenant-c4', { id: 'tenant-c4', plan: 'free' }]],
  });
  const stripe = createFakeStripe();
  const event = makeCheckoutSessionEvent({
    id: 'cs_caso4',
    metadata: { tenant_id: 'tenant-c4', plan_id: 'starter', supabase_user_id: 'user-c4' },
  });

  await handleStripeWebhookEvent(supabase, stripe, event);
  await handleStripeWebhookEvent(supabase, stripe, event); // Stripe re-invia lo stesso evento (retry o duplicato)

  assert.equal(supabase._creditGrants.length, 1, 'nessun doppio accredito su un evento duplicato dopo un successo');
});

test('Caso 5 — concorrenza: due elaborazioni contemporanee della stessa checkout session -> una sola elaborazione effettiva', async () => {
  const supabase = createFakeSupabase(
    { tenants: [['tenant-c5', { id: 'tenant-c5', plan: 'free' }]] },
    {
      // Introduce un vero yield asincrono dentro il "passo crediti": senza il
      // mutex per-session_id (che riproduce il blocco della UNIQUE INSERT
      // reale) le due esecuzioni concorrenti interleaverebbero proprio qui,
      // ed entrambe finirebbero per accreditare/sommare — esponendo la race
      // condition che questo caso deve verificare assente.
      grantCreditsImpl: async () => {
        await new Promise((resolve) => setImmediate(resolve));
        return { ok: true };
      },
    }
  );
  const stripe = createFakeStripe();
  const event = makeCheckoutSessionEvent({
    id: 'cs_caso5',
    metadata: { tenant_id: 'tenant-c5', plan_id: 'starter', supabase_user_id: 'user-c5' },
  });

  await Promise.all([
    handleStripeWebhookEvent(supabase, stripe, event),
    handleStripeWebhookEvent(supabase, stripe, event),
  ]);

  assert.equal(supabase._creditGrants.length, 1, 'solo una delle due elaborazioni concorrenti deve accreditare i crediti');
  assert.equal(supabase._slotGrants.length, 1, 'solo una delle due elaborazioni concorrenti deve sommare gli slot');
  assert.equal(supabase._db.processed_checkout_sessions.size, 1);
});

test('Caso 6 — slot: non vengono duplicati né da un retry dopo successo, né lasciati parzialmente sommati da un errore', async () => {
  const supabase = createFakeSupabase({
    tenants: [['tenant-c6', { id: 'tenant-c6', plan: 'free' }]],
  });
  const stripe = createFakeStripe();
  const event = makeCheckoutSessionEvent({
    id: 'cs_caso6',
    metadata: { tenant_id: 'tenant-c6', plan_id: 'pro', supabase_user_id: 'user-c6' },
  });

  await handleStripeWebhookEvent(supabase, stripe, event);
  await handleStripeWebhookEvent(supabase, stripe, event); // retry/duplicato dopo successo

  assert.equal(supabase._slotGrants.length, 1, 'gli slot vanno sommati una sola volta');
  assert.equal(supabase._slotGrants[0].amount, 5, 'PLAN_SLOTS.pro = 5');
  assert.equal(supabase._db.processed_checkout_sessions.get('cs_caso6').slots_added, 5);

  // Stesso caso, ma con un fallimento crediti: gli slot non devono restare
  // sommati "a metà" se il passo successivo (crediti, nell'ordine reale
  // della migration: crediti PRIMA degli slot) fallisce — qui verifichiamo
  // il caso simmetrico, slot dopo un errore a monte, restano a zero.
  const supabase2 = createFakeSupabase(
    { tenants: [['tenant-c6b', { id: 'tenant-c6b', plan: 'free' }]] },
    { grantCreditsImpl: async () => ({ error: { message: 'boom' } }) }
  );
  const event2 = makeCheckoutSessionEvent({
    id: 'cs_caso6b',
    metadata: { tenant_id: 'tenant-c6b', plan_id: 'pro', supabase_user_id: 'user-c6b' },
  });
  await assert.rejects(() => handleStripeWebhookEvent(supabase2, stripe, event2));
  assert.equal(supabase2._slotGrants.length, 0, 'nessuno slot sommato se il passo crediti (a monte) fallisce');
});

// ─── getFeePriceId: risoluzione da env, non dal fallback LIVE hardcoded ────
// Nato dal test E2E manuale del 2026-08-11 contro Stripe TEST: il checkout
// Business falliva sulla fee subscription con "No such price:
// price_1TmdKuRZR2YaFu2sHeH8fShE" (il default LIVE hardcoded) perché
// l'ambiente locale non aveva STRIPE_FEE_PRICE_BUSINESS impostata — non un
// bug della funzione (che già leggeva process.env prima del fallback), ma
// una lacuna di copertura test su questo comportamento. Guardia di
// regressione: se in futuro qualcuno invertisse l'ordine env/fallback (o
// rimuovesse la lettura da env), questi test lo segnalerebbero subito.
test('getFeePriceId: legge il Price ID da env quando la variabile è impostata (starter/pro/business)', () => {
  const saved = {
    starter: process.env.STRIPE_FEE_PRICE_STARTER,
    pro: process.env.STRIPE_FEE_PRICE_PRO,
    business: process.env.STRIPE_FEE_PRICE_BUSINESS,
  };
  try {
    process.env.STRIPE_FEE_PRICE_STARTER = 'price_env_starter';
    process.env.STRIPE_FEE_PRICE_PRO = 'price_env_pro';
    process.env.STRIPE_FEE_PRICE_BUSINESS = 'price_env_business';

    assert.equal(getFeePriceId('starter'), 'price_env_starter');
    assert.equal(getFeePriceId('pro'), 'price_env_pro');
    assert.equal(getFeePriceId('business'), 'price_env_business');
  } finally {
    for (const [plan, value] of Object.entries(saved)) {
      const key = `STRIPE_FEE_PRICE_${plan.toUpperCase()}`;
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('getFeePriceId: ricade sul default hardcoded (LIVE) solo se la env var è assente, per tutti i piani noti', () => {
  const saved = {
    starter: process.env.STRIPE_FEE_PRICE_STARTER,
    pro: process.env.STRIPE_FEE_PRICE_PRO,
    business: process.env.STRIPE_FEE_PRICE_BUSINESS,
  };
  try {
    delete process.env.STRIPE_FEE_PRICE_STARTER;
    delete process.env.STRIPE_FEE_PRICE_PRO;
    delete process.env.STRIPE_FEE_PRICE_BUSINESS;

    assert.equal(getFeePriceId('starter'), 'price_1TmdIgRZR2YaFu2sT5gkrMdx');
    assert.equal(getFeePriceId('pro'), 'price_1TmdK0RZR2YaFu2s8pXkLety');
    assert.equal(getFeePriceId('business'), 'price_1TmdKuRZR2YaFu2sHeH8fShE');
    // Piano sconosciuto: fallback esplicito su starter (comportamento
    // documentato della funzione, non un bug), non undefined/crash.
    assert.equal(getFeePriceId('non-esiste'), getFeePriceId('starter'));
  } finally {
    for (const [plan, value] of Object.entries(saved)) {
      const key = `STRIPE_FEE_PRICE_${plan.toUpperCase()}`;
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

// ─── STEP 4 — App Catalog billing: subscription_status/stripe_customer_id ──
// Stesso ramo 'app' del webhook di sempre (nessuna modifica a
// classifyStripeEvent/isStaleEvent), esteso in updateAppStatus per scrivere
// anche subscription_status/stripe_customer_id QUANDO la riga ha
// product_id valorizzato (Catalog Instance) — mai per le app non-Catalog
// (Scenario 2/3b/3c sopra, invariati, lo dimostrano già: quelle app non
// hanno product_id e infatti non hanno mai subscription_status/
// stripe_customer_id popolati).

test('STEP4 catalog: checkout.session.completed attiva l\'istanza e sincronizza subscription_status + stripe_customer_id', async () => {
  const supabase = createFakeSupabase({
    apps: [['catalog-app-1', {
      id: 'catalog-app-1',
      status: 'trial',
      subscription_status: 'trialing',
      product_id: 'product-1',
      stripe_event_applied_at: null,
    }]],
  });
  const stripe = createFakeStripe();

  const event = makeCheckoutSessionEvent({
    id: 'cs_catalog_1',
    metadata: { app_id: 'catalog-app-1' },
    customer: 'cus_catalog_1',
    subscription: 'sub_catalog_1',
    created: 1700002000,
  });

  await handleStripeWebhookEvent(supabase, stripe, event);

  const app = supabase._db.apps.get('catalog-app-1');
  assert.equal(app.status, 'active', 'apps.status (source of truth) deve passare a active');
  assert.equal(app.subscription_status, 'active', 'subscription_status deve restare coerente con status');
  assert.equal(app.stripe_subscription_id, 'sub_catalog_1');
  assert.equal(app.stripe_customer_id, 'cus_catalog_1', 'stripe_customer_id deve essere catturato dal checkout');
});

test('STEP4 catalog: invoice.payment_succeeded (rinnovo) mantiene active e sincronizza subscription_status/customer_id', async () => {
  const supabase = createFakeSupabase({
    apps: [['catalog-app-2', {
      id: 'catalog-app-2',
      status: 'active',
      subscription_status: 'active',
      product_id: 'product-1',
      stripe_subscription_id: 'sub_catalog_2',
      stripe_event_applied_at: null,
    }]],
  });
  const stripe = createFakeStripe();

  const event = {
    type: 'invoice.payment_succeeded',
    created: 1700003000,
    data: { object: { subscription: 'sub_catalog_2', customer: 'cus_catalog_2' } },
  };

  await handleStripeWebhookEvent(supabase, stripe, event);

  const app = supabase._db.apps.get('catalog-app-2');
  assert.equal(app.status, 'active');
  assert.equal(app.subscription_status, 'active');
  assert.equal(app.stripe_customer_id, 'cus_catalog_2', 'stripe_customer_id catturato anche al rinnovo, non solo al checkout');
});

test('STEP4 catalog: invoice.payment_failed -> status/subscription_status entrambi past_due', async () => {
  const supabase = createFakeSupabase({
    apps: [['catalog-app-3', {
      id: 'catalog-app-3',
      status: 'active',
      subscription_status: 'active',
      product_id: 'product-1',
      stripe_subscription_id: 'sub_catalog_3',
      stripe_event_applied_at: null,
    }]],
  });
  const stripe = createFakeStripe();

  const event = {
    type: 'invoice.payment_failed',
    created: 1700004000,
    data: { object: { subscription: 'sub_catalog_3', customer: 'cus_catalog_3' } },
  };

  await handleStripeWebhookEvent(supabase, stripe, event);

  const app = supabase._db.apps.get('catalog-app-3');
  assert.equal(app.status, 'past_due');
  assert.equal(app.subscription_status, 'past_due');
});

// ─── BLOCKER #3 (Audit pre-lancio 2026-08-14) — rinnovo reseller estende
// apps.expires_at ─────────────────────────────────────────────────────────
// Prima di questa patch, invoice.payment_succeeded per un'app-cliente
// reseller (product_id NULL) aggiornava solo apps.status='active', mai
// apps.expires_at: il cron di scadenza (jobs/expiry-check.js) blocca
// client_active 5gg dopo expires_at indipendentemente da rinnovi Stripe
// riusciti nel frattempo.

test('BLOCKER #3: rinnovo pagato di un\'app-cliente reseller estende expires_at al period.end della fattura e resetta expiry_warning_sent', async () => {
  const supabase = createFakeSupabase({
    apps: [['reseller-app-1', {
      id: 'reseller-app-1',
      status: 'active',
      product_id: null, // app-cliente reseller, NON una Catalog Instance
      stripe_subscription_id: 'sub_reseller_1',
      expires_at: '2026-01-01T00:00:00.000Z', // periodo precedente, ormai superato
      expiry_warning_sent: true, // avviso già inviato nel ciclo precedente
      stripe_event_applied_at: null,
    }]],
  });
  const stripe = createFakeStripe();

  // 1700100000 = 2023-11-16T00:00:00Z, usato solo come "adesso" dell'evento
  // (isStaleEvent) — il periodo pagato reale è invoice.lines[0].period.end.
  const paidThroughUnix = 1700100000 + 30 * 24 * 60 * 60; // +30gg
  const event = {
    type: 'invoice.payment_succeeded',
    created: 1700100000,
    data: {
      object: {
        subscription: 'sub_reseller_1',
        customer: 'cus_reseller_1',
        lines: { data: [{ period: { start: 1700100000, end: paidThroughUnix } }] },
      },
    },
  };

  await handleStripeWebhookEvent(supabase, stripe, event);

  const app = supabase._db.apps.get('reseller-app-1');
  assert.equal(app.status, 'active');
  assert.equal(app.expires_at, new Date(paidThroughUnix * 1000).toISOString(), 'expires_at deve essere esteso al period.end della fattura, non più fermo al vecchio valore');
  assert.equal(app.expiry_warning_sent, false, 'expiry_warning_sent deve tornare false: il nuovo ciclo deve poter generare di nuovo l\'avviso di scadenza');
});

test('Task 1 — evento invoice.payment_succeeded duplicato (stesso event.created) sul rinnovo reseller: nessuna regressione, stato finale identico', async () => {
  const supabase = createFakeSupabase({
    apps: [['reseller-app-dup', {
      id: 'reseller-app-dup',
      status: 'active',
      product_id: null,
      stripe_subscription_id: 'sub_reseller_dup',
      expires_at: '2026-01-01T00:00:00.000Z',
      expiry_warning_sent: true,
      stripe_event_applied_at: null,
    }]],
  });
  const stripe = createFakeStripe();

  const paidThroughUnix = 1700100000 + 30 * 24 * 60 * 60;
  const event = {
    type: 'invoice.payment_succeeded',
    created: 1700100000,
    data: {
      object: {
        subscription: 'sub_reseller_dup',
        customer: 'cus_reseller_dup',
        lines: { data: [{ period: { start: 1700100000, end: paidThroughUnix } }] },
      },
    },
  };

  // Stesso identico evento (stesso event.created) consegnato due volte da
  // Stripe (retry/redelivery): isStaleEvent confronta con < (non <=), quindi
  // un duplicato con lo stesso timestamp NON è "fuori ordine" e riapplica lo
  // stesso UPDATE — atteso, dato che un UPDATE di stato è idempotente per
  // costruzione (stesso principio già documentato sopra updateAppStatus).
  await handleStripeWebhookEvent(supabase, stripe, event);
  const afterFirst = { ...supabase._db.apps.get('reseller-app-dup') };
  await handleStripeWebhookEvent(supabase, stripe, event);
  const afterSecond = supabase._db.apps.get('reseller-app-dup');

  assert.equal(afterSecond.status, 'active');
  assert.equal(afterSecond.expires_at, afterFirst.expires_at, 'expires_at identico dopo il duplicato, nessun doppio avanzamento del periodo');
  assert.equal(afterSecond.expiry_warning_sent, false, 'expiry_warning_sent resta false, non torna true né si comporta diversamente al secondo giro');
});

test('BLOCKER #3: rinnovo pagato di una Catalog Instance NON tocca expires_at né expiry_warning_sent (fuori scope, resta gestito da status/subscription_status)', async () => {
  const supabase = createFakeSupabase({
    apps: [['catalog-app-renew', {
      id: 'catalog-app-renew',
      status: 'active',
      subscription_status: 'active',
      product_id: 'product-1', // Catalog Instance
      stripe_subscription_id: 'sub_catalog_renew',
      expires_at: null,
      expiry_warning_sent: true, // valore preesistente qualunque: non deve essere toccato
      stripe_event_applied_at: null,
    }]],
  });
  const stripe = createFakeStripe();

  const event = {
    type: 'invoice.payment_succeeded',
    created: 1700100000,
    data: {
      object: {
        subscription: 'sub_catalog_renew',
        customer: 'cus_catalog_renew',
        lines: { data: [{ period: { start: 1700100000, end: 1700100000 + 30 * 24 * 60 * 60 } }] },
      },
    },
  };

  await handleStripeWebhookEvent(supabase, stripe, event);

  const app = supabase._db.apps.get('catalog-app-renew');
  assert.equal(app.status, 'active');
  assert.equal(app.subscription_status, 'active');
  assert.equal(app.expires_at, null, 'una Catalog Instance non ha mai usato expires_at per il proprio ciclo di vita: deve restare invariato');
  assert.equal(app.expiry_warning_sent, true, 'expiry_warning_sent non deve essere toccato per una Catalog Instance: resta il valore preesistente');
});

test('STEP4 catalog: customer.subscription.updated mappa lo stato Stripe su status E subscription_status', async () => {
  const supabase = createFakeSupabase({
    apps: [['catalog-app-4', {
      id: 'catalog-app-4',
      status: 'active',
      subscription_status: 'active',
      product_id: 'product-1',
      stripe_subscription_id: 'sub_catalog_4',
      stripe_event_applied_at: null,
    }]],
  });
  const stripe = createFakeStripe();

  const event = {
    type: 'customer.subscription.updated',
    created: 1700005000,
    data: { object: { id: 'sub_catalog_4', status: 'unpaid', customer: 'cus_catalog_4' } },
  };

  await handleStripeWebhookEvent(supabase, stripe, event);

  const app = supabase._db.apps.get('catalog-app-4');
  assert.equal(app.status, 'past_due', 'stripe status "unpaid" -> apps.status "past_due" (resolveAppStatusFromStripeStatus, invariata)');
  assert.equal(app.subscription_status, 'past_due');
  assert.equal(app.stripe_customer_id, 'cus_catalog_4');
});

test('STEP4 catalog: customer.subscription.deleted -> status/subscription_status entrambi canceled', async () => {
  const supabase = createFakeSupabase({
    apps: [['catalog-app-5', {
      id: 'catalog-app-5',
      status: 'past_due',
      subscription_status: 'past_due',
      product_id: 'product-1',
      stripe_subscription_id: 'sub_catalog_5',
      stripe_event_applied_at: null,
    }]],
  });
  const stripe = createFakeStripe();

  const event = {
    type: 'customer.subscription.deleted',
    created: 1700006000,
    data: { object: { id: 'sub_catalog_5', customer: 'cus_catalog_5' } },
  };

  await handleStripeWebhookEvent(supabase, stripe, event);

  const app = supabase._db.apps.get('catalog-app-5');
  assert.equal(app.status, 'canceled');
  assert.equal(app.subscription_status, 'canceled');
  assert.equal(app.stripe_customer_id, 'cus_catalog_5');
});

test('STEP4 catalog: idempotenza — stesso checkout.session.completed applicato due volte produce lo stesso stato finale', async () => {
  const supabase = createFakeSupabase({
    apps: [['catalog-app-6', {
      id: 'catalog-app-6',
      status: 'trial',
      subscription_status: 'trialing',
      product_id: 'product-1',
      stripe_event_applied_at: null,
    }]],
  });
  const stripe = createFakeStripe();

  const event = makeCheckoutSessionEvent({
    id: 'cs_catalog_dup',
    metadata: { app_id: 'catalog-app-6' },
    customer: 'cus_catalog_6',
    subscription: 'sub_catalog_6',
    created: 1700007000,
  });

  await handleStripeWebhookEvent(supabase, stripe, event);
  await handleStripeWebhookEvent(supabase, stripe, event); // Stripe re-invia lo stesso evento

  const app = supabase._db.apps.get('catalog-app-6');
  assert.equal(app.status, 'active');
  assert.equal(app.subscription_status, 'active');
  assert.equal(app.stripe_subscription_id, 'sub_catalog_6');
  assert.equal(app.stripe_customer_id, 'cus_catalog_6');
});

test('STEP4 catalog: un evento fuori ordine non regredisce subscription_status (stessa guardia isStaleEvent di status)', async () => {
  const appliedAt = 1700008000;
  const supabase = createFakeSupabase({
    apps: [['catalog-app-7', {
      id: 'catalog-app-7',
      status: 'active',
      subscription_status: 'active',
      product_id: 'product-1',
      stripe_subscription_id: 'sub_catalog_7',
      stripe_event_applied_at: new Date(appliedAt * 1000).toISOString(),
    }]],
  });
  const stripe = createFakeStripe();

  const staleEvent = {
    type: 'invoice.payment_failed',
    created: appliedAt - 500, // più vecchio dell'ultimo applicato
    data: { object: { subscription: 'sub_catalog_7', customer: 'cus_catalog_7' } },
  };

  await handleStripeWebhookEvent(supabase, stripe, staleEvent);

  const app = supabase._db.apps.get('catalog-app-7');
  assert.equal(app.status, 'active', 'evento fuori ordine scartato: status non deve regredire');
  assert.equal(app.subscription_status, 'active', 'evento fuori ordine scartato: subscription_status non deve regredire');
  assert.equal(app.stripe_customer_id, undefined, 'un evento scartato come stale non deve scrivere nulla, nemmeno stripe_customer_id');
});

test('STEP4 non-catalog: product_id assente -> subscription_status/stripe_customer_id MAI scritti (comportamento identico a prima dello STEP 4)', async () => {
  const supabase = createFakeSupabase({
    apps: [['legacy-app-1', {
      id: 'legacy-app-1',
      status: 'trial',
      // Nessun product_id: app-cliente pubblicata normalmente (o
      // pubblicazione CreatorAI singola), non una Catalog Instance.
      stripe_event_applied_at: null,
    }]],
  });
  const stripe = createFakeStripe();

  const event = makeCheckoutSessionEvent({
    id: 'cs_legacy_1',
    metadata: { app_id: 'legacy-app-1' },
    customer: 'cus_legacy_1',
    subscription: 'sub_legacy_1',
    created: 1700009000,
  });

  await handleStripeWebhookEvent(supabase, stripe, event);

  const app = supabase._db.apps.get('legacy-app-1');
  assert.equal(app.status, 'active');
  assert.equal(app.stripe_subscription_id, 'sub_legacy_1', 'stripe_subscription_id via extra: comportamento preesistente, invariato');
  assert.equal(app.subscription_status, undefined, 'subscription_status non deve mai essere scritto per un\'app non-Catalog');
  assert.equal(app.stripe_customer_id, undefined, 'stripe_customer_id non deve mai essere scritto per un\'app non-Catalog (STEP 4 lo scrive solo se product_id è presente)');
});
