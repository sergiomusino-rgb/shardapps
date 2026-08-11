// ─── Test E2E di POST /api/sync-plan (audit consistenza crediti Vision, ────
// 2026-08-11) — node:test built-in, nessuna dipendenza nuova, nessuna
// chiamata di rete/DB/Stripe reale.
//
// Perché qui e non in backend/routes/: nessun altro file .test.js vive
// accanto alle route (stesso posto di stripe-route-authorization.test.js,
// che testa la logica pura estratta da questa stessa route) — npm test
// (package.json) fa il glob solo su scripts/**/*.test.js e lib/**/*.test.js,
// per questo il test resta qui invece che in backend/routes/stripe.test.js,
// senza dover toccare lo script di test per un singolo file.
//
// Come si invoca l'handler senza Express/HTTP reale: routes/stripe.js
// costruisce supabase/stripe internamente (getSupabase()/getStripe()),
// quindi — a differenza di handleStripeWebhookEvent(supabase, stripe,
// event), che li riceve come parametri — serve un piccolo seam di test
// (router.__setTestClients, aggiunto in routes/stripe.js SOLO per questo
// scopo, mai usato in produzione). L'handler della route viene poi estratto
// direttamente da router.stack (Express non offre altro modo per invocare
// un singolo handler senza avviare un server HTTP) e chiamato con
// req/res finti minimali.
//
// Uso: node --test lib (dalla cartella backend/), o npm test.

const test = require('node:test');
const assert = require('node:assert/strict');

const router = require('../routes/stripe');

function getSyncPlanHandler() {
  const layer = router.stack.find((l) => l.route && l.route.path === '/sync-plan' && l.route.methods.post);
  return layer.route.stack[0].handle;
}
const syncPlanHandler = getSyncPlanHandler();

// server.js registra questa route dietro il token condiviso
// BACKEND_SERVICE_TOKEN + header x-user-id (stesso schema usato dal
// frontend Next.js per le chiamate server-to-server, vedi getUser() in
// routes/stripe.js) — evita di dover simulare un JWT Supabase reale per
// autenticare l'utente nei test.
process.env.BACKEND_SERVICE_TOKEN = 'test-service-token';

function makeReq({ userId = 'user-1', sessionId = 'cs_test_1', extraBody = {} } = {}) {
  return {
    headers: {
      authorization: 'Bearer test-service-token',
      'x-user-id': userId,
    },
    body: { sessionId, ...extraBody },
  };
}

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

// ─── Mutex per-chiave e simulazione di apply_checkout_session_atomic ───────
// Stessa logica (duplicata intenzionalmente, non condivisa via require) di
// backend/lib/stripe-webhook-handler.test.js: replica le garanzie della
// funzione Postgres reale (supabase/migrations/20260811000000_atomic_
// checkout_session_processing.sql) — marcatura + crediti + slot + piano
// scritti SOLO se ogni passo riesce, mutex per-session_id che riproduce il
// blocco della UNIQUE INSERT reale su esecuzioni concorrenti della stessa
// sessione.
function createKeyedMutex() {
  const tail = new Map();
  return function withLock(key, fn) {
    const prev = tail.get(key) || Promise.resolve();
    const run = prev.then(fn, fn);
    tail.set(key, run.catch(() => {}));
    return run;
  };
}

// `options.grantCreditsImpl`/`options.addSlotsImpl`: di default hanno
// successo; i test sugli errori li sovrascrivono per far fallire il passo
// corrispondente. `options.planUpdateShouldFail`: booleano, fa fallire
// l'ultimo passo (update piano) dopo che crediti/slot sono già stati
// "eseguiti" nella stessa chiamata — verifica che in quel caso nemmeno
// quelli restino committati (stessa transazione).
function createFakeSupabase(seed = {}, options = {}) {
  const db = {
    tenants: new Map(),
    tenant_members: new Map(),
    subscriptions: new Map(),
    processed_checkout_sessions: new Map(),
    ...Object.fromEntries(Object.entries(seed).map(([table, rows]) => [table, new Map(rows)])),
  };

  const grantCreditsImpl = options.grantCreditsImpl || (async () => ({ ok: true }));
  const addSlotsImpl = options.addSlotsImpl || (async () => ({ ok: true }));
  const planUpdateShouldFail = options.planUpdateShouldFail || false;
  const withSessionLock = createKeyedMutex();

  const creditGrants = [];
  const slotGrants = [];
  const planUpdates = [];

  function applyCheckoutSessionAtomic(args) {
    return withSessionLock(args.p_session_id, async () => {
      if (db.processed_checkout_sessions.has(args.p_session_id)) {
        return { data: false, error: null };
      }

      if (args.p_credits_to_add > 0 && args.p_user_id) {
        const result = await grantCreditsImpl({ userId: args.p_user_id, amount: args.p_credits_to_add, sessionId: args.p_session_id });
        if (result?.error) return { data: null, error: result.error };
      }

      if (args.p_slots_to_add > 0) {
        const result = await addSlotsImpl({ tenantId: args.p_tenant_id, amount: args.p_slots_to_add });
        if (result?.error) return { data: null, error: result.error };
      }

      if (planUpdateShouldFail && args.p_plan) {
        return { data: null, error: { message: 'boom: update piano fallito' } };
      }

      // Nessun effetto collaterale scritto finché non siamo sicuri che OGNI
      // passo sia andato a buon fine (stesso "tutto o niente" della
      // transazione reale): solo da qui in poi si scrive davvero in db/*.
      if (args.p_credits_to_add > 0 && args.p_user_id) {
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
          planUpdates.push({ tenantId: args.p_tenant_id, plan: args.p_plan });
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
    const builder = {
      select() {
        return builder;
      },
      eq(col, val) {
        filters.push([col, val]);
        return builder;
      },
      async single() {
        const rows = [...db[table].values()].filter((r) => matchesFilters(r, filters));
        if (rows.length !== 1) return { data: null, error: { message: 'not found or not unique' } };
        return { data: rows[0], error: null };
      },
      async maybeSingle() {
        const rows = [...db[table].values()].filter((r) => matchesFilters(r, filters));
        if (rows.length === 0) return { data: null, error: null };
        return { data: rows[0], error: null };
      },
      async upsert(row, opts) {
        const conflictCol = opts?.onConflict || 'id';
        const key = conflictCol === 'tenant_id' ? row.tenant_id : row.id || `${table}-${db[table].size + 1}`;
        const existing = db[table].get(key) || {};
        db[table].set(key, { ...existing, ...row });
        return { data: row, error: null };
      },
    };
    return builder;
  }

  return {
    from(table) {
      return queryBuilder(table);
    },
    async rpc(fnName, args) {
      if (fnName === 'apply_checkout_session_atomic') {
        return applyCheckoutSessionAtomic(args);
      }
      return { data: null, error: null };
    },
    _db: db,
    _creditGrants: creditGrants,
    _slotGrants: slotGrants,
    _planUpdates: planUpdates,
  };
}

function createFakeStripe({ session, listLineItemsQuantity = 1, failFeeSubscriptionCreate = false } = {}) {
  const created = [];
  return {
    checkout: {
      sessions: {
        async retrieve(id) {
          return { ...session, id };
        },
        async listLineItems(_id, _opts) {
          return { data: [{ quantity: listLineItemsQuantity, price: { id: 'price_x' } }] };
        },
      },
    },
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

function makeSession({ tenantId, planId = 'starter', supabaseUserId = 'user-1', paymentStatus = 'paid' } = {}) {
  return {
    client_reference_id: tenantId,
    metadata: { tenant_id: tenantId, plan_id: planId, supabase_user_id: supabaseUserId },
    payment_status: paymentStatus,
    customer: 'cus_test_1',
  };
}

function seedTenantAndMembership(tenantId, userId, plan = 'free') {
  return {
    tenants: [[tenantId, { id: tenantId, plan, owner_id: userId }]],
    tenant_members: [[`${tenantId}-${userId}`, { tenant_id: tenantId, user_id: userId }]],
  };
}

// A differenza di un semplice { ...seedA, ...seedB } (che sovrascriverebbe
// interamente tenants/tenant_members della prima chiamata con quelli della
// seconda, invece di sommarli), unisce gli array seed di più tenant/utenti
// nello stesso fixture — serve per gli scenari cross-tenant (T9) dove due
// tenant distinti devono coesistere nello stesso fake DB.
function mergeSeeds(...seeds) {
  const merged = {};
  for (const seed of seeds) {
    for (const [table, rows] of Object.entries(seed)) {
      merged[table] = [...(merged[table] || []), ...rows];
    }
  }
  return merged;
}

// ─── T1: richiesta riuscita ─────────────────────────────────────────────
test('T1 — successo: /sync-plan applica piano/slot/crediti una sola volta e crea la fee subscription', async () => {
  const supabase = createFakeSupabase(seedTenantAndMembership('tenant-1', 'user-1'));
  const stripe = createFakeStripe({ session: makeSession({ tenantId: 'tenant-1' }) });
  router.__setTestClients({ supabase, stripe });

  const res = makeRes();
  await syncPlanHandler(makeReq({ userId: 'user-1', sessionId: 'cs_ok_1' }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.paid, true);
  assert.equal(res.body.plan, 'starter');
  assert.equal(res.body.creditsAdded, 20);
  assert.equal(supabase._creditGrants.length, 1);
  assert.equal(supabase._slotGrants.length, 1);
  assert.equal(stripe._created.length, 1, 'fee subscription creata una volta');

  router.__setTestClients({});
});

// ─── T2: errore grant_credits ───────────────────────────────────────────
test('T2 — errore grant_credits: la route risponde 500 e non lascia nessun effetto parziale', async () => {
  const supabase = createFakeSupabase(
    seedTenantAndMembership('tenant-2', 'user-1'),
    { grantCreditsImpl: async () => ({ error: { message: 'boom crediti' } }) }
  );
  const stripe = createFakeStripe({ session: makeSession({ tenantId: 'tenant-2' }) });
  router.__setTestClients({ supabase, stripe });

  const res = makeRes();
  await syncPlanHandler(makeReq({ userId: 'user-1', sessionId: 'cs_err_credits' }), res);

  assert.equal(res.statusCode, 500);
  assert.equal(supabase._db.processed_checkout_sessions.has('cs_err_credits'), false, 'la sessione non deve restare marcata come processata');
  assert.equal(supabase._creditGrants.length, 0);
  assert.equal(supabase._slotGrants.length, 0, 'nessuno slot sommato se i crediti falliscono (stessa transazione)');
  assert.equal(supabase._db.tenants.get('tenant-2').plan, 'free');
  assert.equal(stripe._created.length, 0, 'nessuna fee subscription creata su un fallimento');

  router.__setTestClients({});
});

// ─── T3: errore add_tenant_slots ────────────────────────────────────────
test('T3 — errore add_tenant_slots: la route risponde 500 e non lascia nemmeno i crediti committati', async () => {
  const supabase = createFakeSupabase(
    seedTenantAndMembership('tenant-3', 'user-1'),
    { addSlotsImpl: async () => ({ error: { message: 'boom slot' } }) }
  );
  const stripe = createFakeStripe({ session: makeSession({ tenantId: 'tenant-3' }) });
  router.__setTestClients({ supabase, stripe });

  const res = makeRes();
  await syncPlanHandler(makeReq({ userId: 'user-1', sessionId: 'cs_err_slots' }), res);

  assert.equal(res.statusCode, 500);
  assert.equal(supabase._db.processed_checkout_sessions.has('cs_err_slots'), false);
  assert.equal(supabase._creditGrants.length, 0, 'i crediti "già assegnati" nello stesso tentativo devono comunque risultare rollback-ati');
  assert.equal(supabase._slotGrants.length, 0);

  router.__setTestClients({});
});

// ─── T4: errore update piano ─────────────────────────────────────────────
test('T4 — errore aggiornamento piano: la route risponde 500 e crediti/slot non restano committati', async () => {
  const supabase = createFakeSupabase(
    seedTenantAndMembership('tenant-4', 'user-1'),
    { planUpdateShouldFail: true }
  );
  const stripe = createFakeStripe({ session: makeSession({ tenantId: 'tenant-4' }) });
  router.__setTestClients({ supabase, stripe });

  const res = makeRes();
  await syncPlanHandler(makeReq({ userId: 'user-1', sessionId: 'cs_err_plan' }), res);

  assert.equal(res.statusCode, 500);
  assert.equal(supabase._db.processed_checkout_sessions.has('cs_err_plan'), false);
  assert.equal(supabase._creditGrants.length, 0);
  assert.equal(supabase._slotGrants.length, 0);
  assert.equal(supabase._db.tenants.get('tenant-4').plan, 'free');

  router.__setTestClients({});
});

// ─── T5: retry dopo errore ───────────────────────────────────────────────
test('T5 — retry dopo errore: il primo tentativo fallisce, il secondo riesce, crediti assegnati una sola volta', async () => {
  let attempt = 0;
  const supabase = createFakeSupabase(
    seedTenantAndMembership('tenant-5', 'user-1'),
    {
      grantCreditsImpl: async () => {
        attempt++;
        if (attempt === 1) return { error: { message: 'errore transitorio' } };
        return { ok: true };
      },
    }
  );
  const stripe = createFakeStripe({ session: makeSession({ tenantId: 'tenant-5' }) });
  router.__setTestClients({ supabase, stripe });

  const res1 = makeRes();
  await syncPlanHandler(makeReq({ userId: 'user-1', sessionId: 'cs_retry' }), res1);
  assert.equal(res1.statusCode, 500);

  const res2 = makeRes();
  await syncPlanHandler(makeReq({ userId: 'user-1', sessionId: 'cs_retry' }), res2);
  assert.equal(res2.statusCode, 200);

  assert.equal(supabase._creditGrants.length, 1, 'crediti assegnati esattamente una volta nonostante due tentativi');
  assert.equal(attempt, 2);

  router.__setTestClients({});
});

// ─── T6: richiesta duplicata dopo successo ───────────────────────────────
test('T6 — richiesta duplicata: due chiamate identiche dopo un successo non accreditano due volte né creano due fee subscription', async () => {
  const supabase = createFakeSupabase(seedTenantAndMembership('tenant-6', 'user-1'));
  const stripe = createFakeStripe({ session: makeSession({ tenantId: 'tenant-6' }) });
  router.__setTestClients({ supabase, stripe });

  const res1 = makeRes();
  await syncPlanHandler(makeReq({ userId: 'user-1', sessionId: 'cs_dup' }), res1);
  assert.equal(res1.statusCode, 200);

  const res2 = makeRes();
  await syncPlanHandler(makeReq({ userId: 'user-1', sessionId: 'cs_dup' }), res2);
  assert.equal(res2.statusCode, 200, 'una richiesta duplicata non è un errore, resta un no-op idempotente');

  assert.equal(supabase._creditGrants.length, 1);
  assert.equal(supabase._slotGrants.length, 1);
  assert.equal(stripe._created.length, 1, 'la fee subscription non va ricreata su una chiamata duplicata');

  router.__setTestClients({});
});

// ─── T7: richieste concorrenti ───────────────────────────────────────────
test('T7 — richieste concorrenti: due chiamate simultanee per la stessa sessione -> una sola elaborazione effettiva', async () => {
  const supabase = createFakeSupabase(
    seedTenantAndMembership('tenant-7', 'user-1'),
    {
      grantCreditsImpl: async () => {
        await new Promise((resolve) => setImmediate(resolve));
        return { ok: true };
      },
    }
  );
  const stripe = createFakeStripe({ session: makeSession({ tenantId: 'tenant-7' }) });
  router.__setTestClients({ supabase, stripe });

  const res1 = makeRes();
  const res2 = makeRes();
  await Promise.all([
    syncPlanHandler(makeReq({ userId: 'user-1', sessionId: 'cs_concurrent' }), res1),
    syncPlanHandler(makeReq({ userId: 'user-1', sessionId: 'cs_concurrent' }), res2),
  ]);

  assert.equal(supabase._creditGrants.length, 1, 'solo una delle due chiamate concorrenti deve accreditare i crediti');
  assert.equal(supabase._slotGrants.length, 1);
  assert.equal(supabase._db.processed_checkout_sessions.size, 1);

  router.__setTestClients({});
});

// ─── T8: session_id di un altro tenant, utente non membro ───────────────
test('T8 — cross-tenant: una checkout session di un tenant a cui l\'utente non appartiene viene rifiutata (403), nessuna scrittura', async () => {
  // "tenant-owner" è il vero proprietario della sessione Stripe; "user-attacker"
  // conosce/indovina il session_id (es. da un link condiviso) ma non è né
  // membro né owner di quel tenant.
  const supabase = createFakeSupabase(seedTenantAndMembership('tenant-owner', 'user-owner'));
  const stripe = createFakeStripe({ session: makeSession({ tenantId: 'tenant-owner', supabaseUserId: 'user-owner' }) });
  router.__setTestClients({ supabase, stripe });

  const res = makeRes();
  await syncPlanHandler(makeReq({ userId: 'user-attacker', sessionId: 'cs_owner_session' }), res);

  assert.equal(res.statusCode, 403);
  assert.equal(supabase._creditGrants.length, 0);
  assert.equal(supabase._slotGrants.length, 0);
  assert.equal(supabase._db.processed_checkout_sessions.size, 0, 'nessuna scrittura deve avvenire per un tentativo non autorizzato');

  router.__setTestClients({});
});

// ─── T9: il tenant applicato è SEMPRE quello risolto dalla sessione Stripe ─
test('T9 — impossibilità di manipolare il tenant: un tenantId arbitrario nel body viene ignorato, si usa sempre quello della sessione Stripe', async () => {
  // L'utente è membro di "tenant-attacker" (tenant proprio) e prova a
  // passare quel tenantId nel body sperando che la route lo usi al posto di
  // quello reale della sessione Stripe (che appartiene a un altro tenant).
  const supabase = createFakeSupabase(mergeSeeds(
    seedTenantAndMembership('tenant-attacker', 'user-attacker'),
    seedTenantAndMembership('tenant-victim', 'user-victim'),
  ));
  const stripe = createFakeStripe({ session: makeSession({ tenantId: 'tenant-victim', supabaseUserId: 'user-victim' }) });
  router.__setTestClients({ supabase, stripe });

  const res = makeRes();
  await syncPlanHandler(
    makeReq({ userId: 'user-attacker', sessionId: 'cs_victim_session', extraBody: { tenantId: 'tenant-attacker' } }),
    res
  );

  // tenantId nel body viene semplicemente ignorato dalla route (non
  // distrutturato da req.body): il tenant risolto resta quello della
  // sessione Stripe reale (tenant-victim), di cui l'attaccante non è
  // membro -> 403, non un accredito riuscito sul proprio tenant-attacker.
  assert.equal(res.statusCode, 403);
  assert.equal(supabase._db.tenants.get('tenant-attacker').plan, 'free', 'il tenant dell\'attaccante non deve ricevere nulla');
  assert.equal(supabase._creditGrants.length, 0);

  router.__setTestClients({});
});

// ─── T10: regressione — credit_topup e guardia anti-downgrade invariati ──
test('T10 — regressione: il ramo credit_topup resta invariato (nessun piano/slot dal piano, solo crediti+1 slot) e non crea fee subscription', async () => {
  const supabase = createFakeSupabase(seedTenantAndMembership('tenant-10a', 'user-1', 'starter'));
  const stripe = createFakeStripe({ session: makeSession({ tenantId: 'tenant-10a', planId: 'credit_topup' }), listLineItemsQuantity: 2 });
  router.__setTestClients({ supabase, stripe });

  const res = makeRes();
  await syncPlanHandler(makeReq({ userId: 'user-1', sessionId: 'cs_topup' }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.creditsAdded, 100, 'CREDIT_TOPUP_CREDITS(50) * quantity(2)');
  assert.equal(supabase._slotGrants[0].amount, 2, 'CREDIT_TOPUP_SLOTS(1) * quantity(2)');
  assert.equal(supabase._db.tenants.get('tenant-10a').plan, 'starter', 'il piano non cambia per una ricarica extra');
  assert.equal(stripe._created.length, 0, 'nessuna fee subscription per un topup di crediti');

  router.__setTestClients({});
});

test('T10 — regressione: guardia anti-downgrade invariata — un piano inferiore non retrocede quello già attivo', async () => {
  const supabase = createFakeSupabase(seedTenantAndMembership('tenant-10b', 'user-1', 'business'));
  const stripe = createFakeStripe({ session: makeSession({ tenantId: 'tenant-10b', planId: 'starter' }) });
  router.__setTestClients({ supabase, stripe });

  const res = makeRes();
  await syncPlanHandler(makeReq({ userId: 'user-1', sessionId: 'cs_downgrade' }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(supabase._db.tenants.get('tenant-10b').plan, 'business', 'business (rank 3) non deve essere retrocesso da starter (rank 1)');
  // I crediti Vision del piano acquistato restano comunque accreditati:
  // solo l'update di tenants.plan è gated dal rank, non i crediti/slot.
  assert.equal(supabase._creditGrants.length, 1);

  router.__setTestClients({});
});
