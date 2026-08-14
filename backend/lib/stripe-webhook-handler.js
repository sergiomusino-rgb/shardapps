// ─── Handler webhook Stripe (orchestrazione I/O) ────────────────────────────
// Estratto da backend/server.js (Fase 3, completamento — test E2E) per
// renderlo chiamabile direttamente con supabase/stripe iniettati, senza
// passare da Express/HTTP reali. Nessuna riga di logica cambiata rispetto a
// quando viveva in server.js: stesso comportamento, stesso ordine delle
// query, stesse guardie — solo relocato per essere testabile end-to-end con
// un client Supabase/Stripe finti (vedi stripe-webhook-handler.test.js).
//
// backend/server.js resta il proprietario della route Express
// (/api/webhooks/stripe): verifica la firma, crea supabase/stripe reali, e
// chiama handleStripeWebhookEvent(supabase, stripe, event) qui sotto.

const {
  PLAN_RANK,
  resolveAppStatusFromStripeStatus,
  resolveCatalogSubscriptionStatus,
  extractStripeId,
  isStaleEvent,
  classifyStripeEvent,
  resolvePlanFromProductName,
} = require('./stripe-webhook-logic');

function getPeriodISO(sub, field) {
  const val = sub[field];
  // Difesa in profondità: se in futuro Stripe sposta di nuovo questi campi
  // (o li omette in un tipo di evento non ancora coperto da un fallback
  // esplicito), un valore mancante non deve far crashare l'intero handler
  // del webhook con RangeError — meglio null (upsert lo scrive com'è) che
  // un 500 che fa perdere Stripe la consegna dell'intero evento.
  if (val == null) return null;
  return new Date(val * 1000).toISOString();
}

function getFeePriceId(planId) {
  // Recurring monthly fee price IDs. Override via env (STRIPE_FEE_PRICE_*),
  // stesso pattern di routes/stripe.js::getFeePriceId: gli ID Price sono
  // specifici per modalità Stripe (test/live) — senza un override da env,
  // passare da una chiave test a una live (o viceversa) senza aggiornare
  // questi valori fa fallire silenziosamente la creazione della fee
  // subscription (errore "No such price", solo loggato, vedi catch sotto).
  const feePrices = {
    starter: process.env.STRIPE_FEE_PRICE_STARTER || 'price_1TmdIgRZR2YaFu2sT5gkrMdx',
    pro: process.env.STRIPE_FEE_PRICE_PRO || 'price_1TmdK0RZR2YaFu2s8pXkLety',
    business: process.env.STRIPE_FEE_PRICE_BUSINESS || 'price_1TmdKuRZR2YaFu2sHeH8fShE',
  };
  return feePrices[planId] || feePrices.starter;
}

async function upsertSubscription(supabase, tenantId, data) {
  const { error } = await supabase
    .from('subscriptions')
    .upsert(
      {
        tenant_id: tenantId,
        stripe_customer_id: data.stripe_customer_id,
        stripe_subscription_id: data.stripe_subscription_id,
        status: data.status,
        current_period_start: data.current_period_start,
        current_period_end: data.current_period_end,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id' }
    );

  if (error) {
    console.error('upsertSubscription error:', error);
    throw error;
  }
}

const PLAN_SLOTS = { starter: 1, pro: 5, business: 50, basic: 1, vip: 100, credit_topup: 1 };

// Crediti Vision inclusi in ogni piano (setup una tantum) e nella ricarica
// extra "credit_topup" (ex "extra_slot" — stesso Price Stripe da 15€, vedi
// routes/stripe.js), che oltre ai crediti concede anche 1 slot app.
const PLAN_CREDITS = { starter: 20, pro: 100, business: 500, credit_topup: 50 };

// Somma slot/crediti e (opzionalmente) aggiorna il piano del tenant una sola
// volta per checkout session, indipendentemente da quale dei punti di sync
// (webhook, pagina /success, banner dashboard) la processa per primo o se
// Stripe re-invia lo stesso evento webhook. Il modello degli slot è cumulativo
// (vedi supabase_migrations/20260722_update_tenants_slots_cumulative.sql),
// quindi senza questa guardia una stessa sessione sommerebbe slot/crediti più
// volte.
// `creditsToAdd`/`userId`: i crediti Vision sono legati all'utente che ha
// pagato (profiles.user_id), non al tenant/workspace — coerenti con come
// vengono spesi in frontend/app/api/generate-video.
//
// Firma/comportamento verso il chiamante INVARIATI (throw se fallisce per un
// errore reale, false se già processata, true se applicata ora) — cambia
// solo l'implementazione. Prima marcatura/crediti/slot/piano erano 4
// scritture SEPARATE: se grant_credits falliva, l'errore veniva solo
// loggato (mai propagato) e la sessione restava comunque marcata come
// processata — un retry Stripe la trovava già "fatta" e non riprovava mai
// più l'accredito (bug: cliente pagante senza crediti Vision). Ora l'intera
// operazione è un'UNICA funzione Postgres
// (apply_checkout_session_atomic, 20260811000000_atomic_checkout_session_
// processing.sql) eseguita come singola transazione: se un qualunque passo
// fallisce, Postgres annulla anche l'INSERT di marcatura — il retry di
// Stripe ritrova la sessione libera e riesegue l'intera operazione da capo,
// non solo il pezzo fallito. Vedi commenti nella migration per i dettagli
// su idempotenza/concorrenza (ON CONFLICT DO NOTHING + FOR UPDATE).
async function applyCheckoutSessionOnce(supabase, sessionId, tenantId, plan, slotsToAdd, creditsToAdd = 0, userId = null) {
  const { data: applied, error } = await supabase.rpc('apply_checkout_session_atomic', {
    p_session_id: sessionId,
    p_tenant_id: tenantId,
    p_plan: plan,
    p_slots_to_add: slotsToAdd,
    p_credits_to_add: creditsToAdd,
    p_user_id: userId,
    p_plan_rank_map: PLAN_RANK,
  });

  if (error) {
    // Propagato al chiamante (handleStripeWebhookEvent -> server.js), che
    // risponde 500: Stripe interpreta la mancata consegna come fallita e
    // ritenta l'evento più tardi. Nessuna riga resta marcata come
    // processata (rollback atomico lato DB — vedi migration), quindi il
    // retry rieseguirà l'intera operazione, non solo il pezzo fallito.
    console.error(`[Stripe Webhook] errore applicazione sessione ${sessionId}:`, error);
    throw error;
  }

  if (!applied) {
    console.log(`[Stripe Webhook] sessione ${sessionId} già processata, skip`);
    return false;
  }

  console.log(`[Stripe Webhook] sessione ${sessionId} applicata: plan=${plan || 'n/d'}, +${slotsToAdd} slot, +${creditsToAdd} crediti`);
  return true;
}

async function getTenantIdBySubscriptionId(supabase, subscriptionId) {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('tenant_id')
    .eq('stripe_subscription_id', subscriptionId)
    .single();

  if (error || !data) return null;
  return data.tenant_id;
}

// ─── Ciclo di vita subscription app-cliente (paywall trial) ────────────────
// Le due tabelle (subscriptions per i tenant reseller, apps per le singole
// app-cliente) non condividono mai lo stesso stripe_subscription_id: questa
// lookup va sempre provata per prima nei case sotto, con `break` immediato
// se trova un match, altrimenti si prosegue con la logica reseller invariata.
async function getAppIdBySubscriptionId(supabase, subscriptionId) {
  const { data, error } = await supabase
    .from('apps')
    .select('id')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();

  if (error || !data) return null;
  return data.id;
}

// Un semplice UPDATE di stato è idempotente per costruzione (riapplicare lo
// stesso status non ha effetti diversi da applicarlo una volta sola): a
// differenza della grant di slot/crediti del ramo reseller sotto, qui non
// serve una guardia processed_checkout_sessions.
//
// eventCreatedAt (caso 13, eventi fuori ordine): il campo `created`
// dell'Event Stripe che ha scatenato questo update. Confrontato contro
// apps.stripe_event_applied_at (20260809000007_add_apps_stripe_event_applied_at.sql),
// NON contro updated_at: apps viene scritta da 15+ percorsi non legati a
// Stripe (cron di scadenza, azioni reseller/cliente, ecc.) e il trigger
// tr_apps_updated_at bump updated_at su QUALUNQUE update — usarlo come
// riferimento avrebbe scartato eventi Stripe legittimi solo perché
// consegnati vicino nel tempo a una scrittura non correlata (falso
// positivo verificato nell'audit Fase 3B). stripe_event_applied_at è
// scritta SOLO da questa funzione, quindi riflette esclusivamente l'ultimo
// evento Stripe applicato.
// catalogExtra (STEP 4, App Catalog billing): campi che vanno scritti SOLO se
// questa riga è una Catalog Instance (product_id IS NOT NULL) — per ogni
// altra app (product_id NULL: pubblicazione CreatorAI singola o app-cliente
// reseller) il comportamento resta IDENTICO a prima di questo step, `extra`
// (il parametro preesistente, invariato) resta l'unico modo di scrivere
// colonne aggiuntive. Non unificato con `extra` di proposito: `extra` è già
// usato da un chiamante non-Catalog (checkout.session.completed, per
// TUTTE le app) e deve restare tale e quale; mescolarci dentro campi
// condizionati al product_id renderebbe quel call site ambiguo su quali
// colonne scrive per chi.
async function updateAppStatus(supabase, appId, status, eventCreatedAt, extra = {}, catalogExtra = {}) {
  const { data: current } = await supabase
    .from('apps')
    .select('stripe_event_applied_at, product_id')
    .eq('id', appId)
    .maybeSingle();

  if (isStaleEvent(eventCreatedAt, current?.stripe_event_applied_at)) {
    console.log(`[Stripe Webhook] evento fuori ordine ignorato per app ${appId} (status richiesto: ${status})`);
    return false;
  }

  const update = { status, updated_at: new Date().toISOString(), ...extra };
  if (eventCreatedAt != null) {
    update.stripe_event_applied_at = new Date(eventCreatedAt * 1000).toISOString();
  }

  // Catalog Instance (STEP 4): apps.status resta l'unica source of truth del
  // lifecycle, ma apps.subscription_status (colonna "vetrina" letta dalla UI
  // del catalogo, 20260815000000_app_catalog_core_schema.sql) deve restare
  // coerente con esso, non congelata a 'trialing' per sempre — vedi analisi
  // STEP 4. Idem per stripe_subscription_id/stripe_customer_id: catturati
  // opportunisticamente ad OGNI evento in cui Stripe li fornisce (non solo al
  // checkout, a differenza del ramo non-Catalog), perché una Catalog
  // Instance non ha un altro punto in cui questi due id vengano mai scritti.
  if (current?.product_id) {
    const subscriptionStatus = resolveCatalogSubscriptionStatus(status);
    if (subscriptionStatus) update.subscription_status = subscriptionStatus;
    if (catalogExtra.stripe_subscription_id) update.stripe_subscription_id = catalogExtra.stripe_subscription_id;
    if (catalogExtra.stripe_customer_id) update.stripe_customer_id = catalogExtra.stripe_customer_id;
  }

  const { error } = await supabase
    .from('apps')
    .update(update)
    .eq('id', appId);
  if (error) console.error(`[Stripe Webhook] errore aggiornamento apps.status (app ${appId}):`, error);
  return !error;
}

// Stesso principio di updateAppStatus, per la subscription reseller
// (tabella subscriptions). Non incapsulata in upsertSubscription: quella
// resta condivisa anche dai percorsi di PRIMA creazione (fee subscription
// creata in checkout.session.completed/payment_intent.succeeded), dove
// "fuori ordine" non si applica — non c'è ancora nulla da sovrascrivere.
async function isTenantSubscriptionUpdateStale(supabase, tenantId, eventCreatedAt) {
  const { data } = await supabase
    .from('subscriptions')
    .select('updated_at')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  return isStaleEvent(eventCreatedAt, data?.updated_at);
}

const KNOWN_PLANS = ['starter', 'pro', 'business', 'basic', 'vip'];

async function resolvePlanFromSession(stripe, session) {
  // Il piano scelto è già salvato correttamente in metadata.plan_id al
  // momento della creazione della sessione (vedi routes/stripe.js) — è la
  // stessa fonte usata da /api/sync-plan. Prima questa funzione indovinava
  // il piano solo dal nome del prodotto Stripe (vip/pro/basic) e faceva
  // fallback a "pro" per QUALSIASI nome non riconosciuto (es. "starter" o
  // "business") o in caso di errore: il webhook, che è la fonte autoritativa
  // lato server, sovrascriveva così il piano corretto già impostato dal
  // client con "pro". Il match sul nome resta solo come fallback per
  // sessioni vecchie prive di questo metadata.
  const metadataPlan = session.metadata?.plan_id;
  if (metadataPlan && KNOWN_PLANS.includes(metadataPlan)) return metadataPlan;

  try {
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
    const priceId = lineItems.data[0]?.price?.id;
    if (!priceId) {
      console.error(`[resolvePlanFromSession] sessione ${session.id}: nessun line item/price trovato, fallback a '${metadataPlan || 'starter'}'`);
      return metadataPlan || 'starter';
    }
    const price = await stripe.prices.retrieve(priceId);
    const productId = typeof price.product === 'string' ? price.product : price.product?.id;
    if (!productId) {
      console.error(`[resolvePlanFromSession] sessione ${session.id}: price ${priceId} senza product associato, fallback a '${metadataPlan || 'starter'}'`);
      return metadataPlan || 'starter';
    }
    const product = await stripe.products.retrieve(productId);
    const resolvedPlan = resolvePlanFromProductName(product.name);
    if (!resolvedPlan) {
      console.error(`[resolvePlanFromSession] sessione ${session.id}: nome prodotto Stripe "${product.name}" non riconosciuto, fallback a '${metadataPlan || 'starter'}'`);
      return metadataPlan || 'starter';
    }
    return resolvedPlan;
  } catch (err) {
    console.error(`[resolvePlanFromSession] sessione ${session.id}: errore durante la risoluzione del piano, fallback a '${metadataPlan || 'starter'}'`, err);
    return metadataPlan || 'starter';
  }
}

// ─── Entry point unico: gestisce un evento Stripe già verificato ──────────
// Chiamata da backend/server.js dopo verifyWebhookSignature. Nessuna
// gestione HTTP qui dentro (né status code né res.json): il chiamante
// decide come rispondere in base a successo/eccezione. Stesso identico
// comportamento di quando questo switch viveva inline nella route Express.
async function handleStripeWebhookEvent(supabase, stripe, event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;

      // Routing: decisione app-vs-reseller presa PRIMA di qualunque I/O da
      // classifyStripeEvent (lib/stripe-webhook-logic.js, testata) — per
      // questo evento è sempre possibile deciderlo solo dai metadata, senza
      // interrogare il DB.
      const target = classifyStripeEvent(event);

      if (target.type === 'app') {
        const appSubscriptionId = extractStripeId(session.subscription);
        const appCustomerId = extractStripeId(session.customer);
        await updateAppStatus(
          supabase,
          target.appId,
          'active',
          event.created,
          appSubscriptionId ? { stripe_subscription_id: appSubscriptionId } : {},
          { stripe_subscription_id: appSubscriptionId, stripe_customer_id: appCustomerId }
        );
        console.log(`[Stripe Webhook] App ${target.appId} attivata (subscription ${appSubscriptionId || 'n/d'})`);
        break;
      }

      const tenantId = target.type === 'reseller' ? target.tenantId : null;
      const customerEmail = session.customer_email || session.customer_details?.email;

      console.log(`[Stripe Webhook] checkout.session.completed - sessionId: ${session.id}, tenantId: ${tenantId}, email: ${customerEmail}`);

      if (!tenantId) {
        console.error('[Stripe Webhook] tenant_id mancante');
        break;
      }

      const planId = session.metadata?.plan_id || 'starter';
      const quantity = parseInt(session.metadata?.quantity || '1', 10);
      const supabaseUserId = session.metadata?.supabase_user_id || null;

      // Verifica che il tenant esista
      const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .select('id')
        .eq('id', tenantId)
        .single();

      if (tenantError || !tenant) {
        console.error(`[Stripe Webhook] tenant ${tenantId} non trovato`, tenantError);
        break;
      }

      // Handle "Ricarica Extra" - accredita crediti Vision e slot app
      // (quantity * 50 crediti, quantity * 1 slot).
      if (planId === 'credit_topup') {
        const creditsToAdd = (PLAN_CREDITS.credit_topup || 0) * quantity;
        const slotsToAdd = (PLAN_SLOTS.credit_topup || 0) * quantity;
        // Chiave di idempotenza = payment_intent, non session.id: sia questo
        // evento che payment_intent.succeeded (sotto) accreditano lo stesso
        // acquisto credit_topup, e Stripe invia sempre entrambi per i
        // checkout mode:'payment'. Usare lo stesso id in entrambi i punti fa
        // sì che processed_checkout_sessions catturi il duplicato invece di
        // accreditare due volte (era il bug: due chiavi diverse per lo
        // stesso acquisto bypassavano il vincolo unique).
        const idempotencyKey = session.payment_intent || session.id;
        const applied = await applyCheckoutSessionOnce(supabase, idempotencyKey, tenantId, null, slotsToAdd, creditsToAdd, supabaseUserId);
        if (applied) {
          console.log(`[Stripe Webhook] +${creditsToAdd} crediti Vision e +${slotsToAdd} slot (ricarica extra) per tenant ${tenantId}`);
        }
      } else {
        // Regular plan - risolve il piano e somma slot + crediti Vision
        // (cumulativo), il campo "plan" mostra sempre l'ultimo piano acquistato
        const plan = await resolvePlanFromSession(stripe, session);
        console.log(`[Stripe Webhook] piano risolto: ${plan}`);

        const slotsToAdd = PLAN_SLOTS[plan] || 1;
        const creditsToAdd = PLAN_CREDITS[plan] || 0;
        const applied = await applyCheckoutSessionOnce(supabase, session.id, tenantId, plan, slotsToAdd, creditsToAdd, supabaseUserId);
        if (applied) {
          console.log(`[Stripe Webhook] tenant ${tenantId} aggiornato: plan=${plan}, +${slotsToAdd} slot, +${creditsToAdd} crediti`);
        }
      }

      // Le sessioni di checkout sono in mode:'payment' (Managed Payments):
      // session.subscription non esiste mai (era per il vecchio flusso
      // mode:'subscription', rimosso). La fee subscription ricorrente da
      // 25€/app va creata a parte, legata al customer — via primaria è
      // /sync-plan in routes/stripe.js (chiamato subito dopo il checkout
      // dalla pagina /success, non dipende dalla consegna del webhook);
      // questo blocco è solo un backup idempotente nel caso sync-plan non
      // venga mai chiamato (es. utente chiude la scheda prima del redirect).
      if (planId !== 'credit_topup') {
        const { data: existingSub } = await supabase
          .from('subscriptions')
          .select('stripe_subscription_id')
          .eq('tenant_id', tenantId)
          .maybeSingle();

        if (!existingSub?.stripe_subscription_id) {
          const feePriceId = getFeePriceId(planId);
          try {
            const feeSubscription = await stripe.subscriptions.create({
              customer: session.customer,
              items: [{ price: feePriceId, quantity: 0 }], // Inizia da 0, verrà incrementata con le app
              metadata: { tenant_id: tenantId, type: 'app_fee' },
              proration_behavior: 'always_invoice',
              // Niente trial_period_days qui: il trial è per singola app
              // (dal primo login dell'owner, vedi apps.owner_trial_ends_at
              // e /update-app-fee), non sull'intera subscription.
            });

            // current_period_start/end non sono più sulla subscription ma
            // sul subscription item in questa API version.
            const feeSubItem = feeSubscription.items.data[0];
            await upsertSubscription(supabase, tenantId, {
              stripe_customer_id: session.customer,
              stripe_subscription_id: feeSubscription.id,
              status: feeSubscription.status,
              current_period_start: getPeriodISO(feeSubItem, 'current_period_start'),
              current_period_end: getPeriodISO(feeSubItem, 'current_period_end'),
            });

            console.log(`[Stripe Webhook] Fee subscription creata: ${feeSubscription.id} per tenant ${tenantId}`);
          } catch (err) {
            console.error(`[Stripe Webhook] Errore creazione fee subscription:`, err);
          }
        }
      }

      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      // Routing: subscriptionId estratto (puro) da classifyStripeEvent —
      // stesso fallback di prima. L'effettiva classificazione app-vs-reseller
      // richiede ancora la query sotto: nessuna funzione pura può saperlo
      // senza il DB.
      const routingTarget = classifyStripeEvent(event);
      if (routingTarget.type !== 'requires-lookup') break;
      const subscriptionId = routingTarget.subscriptionId;

      // Rinnovo di un abbonamento app-cliente: controllato prima del ramo
      // reseller sotto, le due tabelle non si sovrappongono mai sullo
      // stesso stripe_subscription_id.
      const paidAppId = await getAppIdBySubscriptionId(supabase, subscriptionId);
      if (paidAppId) {
        // Audit pre-lancio 2026-08-14, BLOCKER #3: prima di questa patch un
        // rinnovo pagato aggiornava solo apps.status='active', mai
        // apps.expires_at — che resta fermo a "creazione+30gg"
        // (frontend/app/api/apps/route.ts) per sempre. Il cron di scadenza
        // (backend/jobs/expiry-check.js) blocca client_active 5gg dopo
        // expires_at indipendentemente da eventuali rinnovi Stripe riusciti
        // nel frattempo: un cliente che pagava regolarmente veniva comunque
        // bloccato alla scadenza del PRIMO periodo. Il periodo davvero
        // pagato è sulla riga della fattura (invoice.lines.data[0].period.end,
        // sempre presente per una fattura di abbonamento) — stessa
        // subscription a riga singola creata in apps/checkout/route.ts,
        // nessuna ambiguità su quale riga leggere.
        //
        // SOLO per app-cliente reseller (product_id NULL): una Catalog
        // Instance (product_id NOT NULL) non ha mai usato expires_at per il
        // proprio ciclo di vita — la revoca/il rinnovo per queste passano
        // interamente da apps.status/subscription_status (vedi BLOCKER #2,
        // clientAuthMiddleware). Impostarlo anche qui le esporrebbe per la
        // prima volta al cron di scadenza reseller, un comportamento che non
        // hanno mai avuto — non necessario per chiudere questo caso e fuori
        // scope per il modello Catalog.
        const { data: paidApp } = await supabase.from('apps').select('product_id').eq('id', paidAppId).maybeSingle();
        const paidPeriodEnd = invoice.lines?.data?.[0]?.period?.end;
        const extra = (!paidApp?.product_id && paidPeriodEnd)
          ? { expires_at: new Date(paidPeriodEnd * 1000).toISOString() }
          : {};

        await updateAppStatus(supabase, paidAppId, 'active', event.created, extra, {
          stripe_subscription_id: subscriptionId,
          stripe_customer_id: extractStripeId(invoice.customer),
        });
        console.log(`[Stripe Webhook] Rinnovo pagato per app ${paidAppId}${extra.expires_at ? `, expires_at esteso a ${extra.expires_at}` : ''}`);
        break;
      }

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const tenantId = await getTenantIdBySubscriptionId(supabase, subscriptionId);

      if (!tenantId) {
        console.error(`invoice.payment_succeeded: tenant non trovato per ${subscriptionId}`);
        break;
      }

      if (await isTenantSubscriptionUpdateStale(supabase, tenantId, event.created)) {
        console.log(`[Stripe Webhook] evento fuori ordine ignorato per tenant ${tenantId} (invoice.payment_succeeded)`);
        break;
      }

      // Stesso spostamento: current_period_start/end sono ora sul subscription
      // item, non più sulla subscription stessa (vedi anche routes/stripe.js).
      const periodSource = subscription.items?.data?.[0] || subscription;
      await upsertSubscription(supabase, tenantId, {
        stripe_customer_id: invoice.customer,
        stripe_subscription_id: subscriptionId,
        status: subscription.status,
        current_period_start: getPeriodISO(periodSource, 'current_period_start'),
        current_period_end: getPeriodISO(periodSource, 'current_period_end'),
      });

      console.log(`Rinnovo pagato per tenant ${tenantId}`);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const routingTarget = classifyStripeEvent(event);
      if (routingTarget.type !== 'requires-lookup') break;
      const subscriptionId = routingTarget.subscriptionId;

      const failedAppId = await getAppIdBySubscriptionId(supabase, subscriptionId);
      if (failedAppId) {
        await updateAppStatus(supabase, failedAppId, 'past_due', event.created, {}, {
          stripe_subscription_id: subscriptionId,
          stripe_customer_id: extractStripeId(invoice.customer),
        });
        console.log(`[Stripe Webhook] Pagamento fallito per app ${failedAppId}`);
        break;
      }

      const tenantId = await getTenantIdBySubscriptionId(supabase, subscriptionId);
      if (!tenantId) {
        console.warn(`[Stripe Webhook] Webhook received for non-existent or unresolved entity ID: ${subscriptionId} (invoice.payment_failed)`);
        break;
      }

      if (await isTenantSubscriptionUpdateStale(supabase, tenantId, event.created)) {
        console.log(`[Stripe Webhook] evento fuori ordine ignorato per tenant ${tenantId} (invoice.payment_failed)`);
        break;
      }

      await supabase
        .from('subscriptions')
        .update({ status: 'past_due', updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .eq('stripe_subscription_id', subscriptionId);

      console.log(`Pagamento fallito per tenant ${tenantId}`);
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const routingTarget = classifyStripeEvent(event);
      if (routingTarget.type !== 'requires-lookup') break;
      const subscriptionId = routingTarget.subscriptionId;

      const deletedAppId = await getAppIdBySubscriptionId(supabase, subscriptionId);
      if (deletedAppId) {
        await updateAppStatus(supabase, deletedAppId, 'canceled', event.created, {}, {
          stripe_subscription_id: subscriptionId,
          stripe_customer_id: extractStripeId(subscription.customer),
        });
        console.log(`[Stripe Webhook] Subscription cancellata per app ${deletedAppId}`);
        break;
      }

      const tenantId = await getTenantIdBySubscriptionId(supabase, subscriptionId);
      if (!tenantId) {
        console.warn(`[Stripe Webhook] Webhook received for non-existent or unresolved entity ID: ${subscriptionId} (customer.subscription.deleted)`);
        break;
      }

      if (await isTenantSubscriptionUpdateStale(supabase, tenantId, event.created)) {
        console.log(`[Stripe Webhook] evento fuori ordine ignorato per tenant ${tenantId} (customer.subscription.deleted)`);
        break;
      }

      await supabase
        .from('subscriptions')
        .update({ status: 'canceled', updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .eq('stripe_subscription_id', subscriptionId);

      console.log(`Subscription cancellata per tenant ${tenantId}`);
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const routingTarget = classifyStripeEvent(event);
      if (routingTarget.type !== 'requires-lookup') break;
      const subscriptionId = routingTarget.subscriptionId;

      const updatedAppId = await getAppIdBySubscriptionId(supabase, subscriptionId);
      if (updatedAppId) {
        const newAppStatus = resolveAppStatusFromStripeStatus(subscription.status);
        if (newAppStatus) {
          await updateAppStatus(supabase, updatedAppId, newAppStatus, event.created, {}, {
            stripe_subscription_id: subscriptionId,
            stripe_customer_id: extractStripeId(subscription.customer),
          });
          console.log(`[Stripe Webhook] App ${updatedAppId} sincronizzata a '${newAppStatus}'`);
        }
        break;
      }

      const tenantId = await getTenantIdBySubscriptionId(supabase, subscriptionId);
      if (!tenantId) {
        console.warn(`[Stripe Webhook] Webhook received for non-existent or unresolved entity ID: ${subscriptionId} (customer.subscription.updated)`);
        break;
      }

      if (await isTenantSubscriptionUpdateStale(supabase, tenantId, event.created)) {
        console.log(`[Stripe Webhook] evento fuori ordine ignorato per tenant ${tenantId} (customer.subscription.updated)`);
        break;
      }

      // current_period_start/end non sono più sulla subscription ma sul
      // subscription item (vedi commento in invoice.payment_succeeded sopra):
      // senza questo fallback getPeriodISO riceve undefined e
      // toISOString() lancia RangeError, facendo fallire l'intero webhook
      // con 500 (bug osservato su evento reale il 2026-08-04).
      const periodSource = subscription.items?.data?.[0] || subscription;
      await upsertSubscription(supabase, tenantId, {
        stripe_customer_id: subscription.customer,
        stripe_subscription_id: subscriptionId,
        status: subscription.status,
        current_period_start: getPeriodISO(periodSource, 'current_period_start'),
        current_period_end: getPeriodISO(periodSource, 'current_period_end'),
      });

      console.log(`Subscription aggiornata per tenant ${tenantId}`);
      break;
    }

    case 'payment_intent.succeeded': {
      const paymentIntent = event.data.object;
      const routingTarget = classifyStripeEvent(event);
      const planId = paymentIntent.metadata?.plan_id;
      const quantity = parseInt(paymentIntent.metadata?.quantity || '1', 10);
      const feePriceId = paymentIntent.metadata?.fee_price_id;
      const supabaseUserId = paymentIntent.metadata?.supabase_user_id || null;

      if (routingTarget.type !== 'reseller') {
        break;
      }
      const tenantId = routingTarget.tenantId;

      console.log(`[Stripe Webhook] payment_intent.succeeded for tenant ${tenantId}, plan ${planId}`);

      // Verifica che il tenant esista
      const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .select('id')
        .eq('id', tenantId)
        .single();

      if (tenantError || !tenant) {
        console.error(`[Stripe Webhook] tenant ${tenantId} non trovato`, tenantError);
        break;
      }

      // Handle "Ricarica Extra" (ex slot extra) - accredita crediti Vision,
      // idempotente su paymentIntent.id. Niente try/catch qui (rimosso
      // 2026-08-11, fix consistenza crediti Vision): un errore di
      // applyCheckoutSessionOnce deve propagarsi fino a server.js e far
      // rispondere 500, esattamente come nel branch reseller di
      // checkout.session.completed sopra — altrimenti l'errore veniva
      // solo loggato, il webhook rispondeva comunque 200 e Stripe non
      // ritentava mai più questo evento (stesso bug della sessione marcata
      // come processata nonostante grant_credits fallito).
      if (planId === 'credit_topup') {
        const creditsToAdd = (PLAN_CREDITS.credit_topup || 0) * quantity;
        const slotsToAdd = (PLAN_SLOTS.credit_topup || 0) * quantity;
        const applied = await applyCheckoutSessionOnce(supabase, paymentIntent.id, tenantId, null, slotsToAdd, creditsToAdd, supabaseUserId);
        if (applied) {
          console.log(`[Stripe Webhook] +${creditsToAdd} crediti Vision e +${slotsToAdd} slot (ricarica extra) per tenant ${tenantId}`);
        }
      } else {
        // Regular plan upgrade - create subscription (stesso guard idempotente
        // usato nel branch checkout.session.completed: senza, ogni evento
        // duplicato payment_intent.succeeded/checkout.session.completed per lo
        // stesso acquisto creava una fee subscription orfana e non tracciata).
        const { data: existingSub } = await supabase
          .from('subscriptions')
          .select('stripe_subscription_id')
          .eq('tenant_id', tenantId)
          .maybeSingle();

        if (feePriceId && !existingSub?.stripe_subscription_id) {
          try {
            const feeSubscription = await stripe.subscriptions.create({
              customer: paymentIntent.customer,
              items: [{ price: feePriceId, quantity: 0 }],
              metadata: { tenant_id: tenantId, type: 'app_fee' },
              proration_behavior: 'always_invoice',
            });

            const feeSubItem = feeSubscription.items.data[0];
            await upsertSubscription(supabase, tenantId, {
              stripe_customer_id: paymentIntent.customer,
              stripe_subscription_id: feeSubscription.id,
              status: feeSubscription.status,
              current_period_start: getPeriodISO(feeSubItem, 'current_period_start'),
              current_period_end: getPeriodISO(feeSubItem, 'current_period_end'),
            });

            console.log(`[Stripe Webhook] Fee subscription creata: ${feeSubscription.id} per tenant ${tenantId}`);
          } catch (err) {
            console.error(`[Stripe Webhook] Errore creazione fee subscription:`, err);
          }
        }
      }
      break;
    }

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }
}

module.exports = {
  handleStripeWebhookEvent,
  // Esportate per il test E2E e per eventuale riuso (non usate altrove oggi):
  getPeriodISO,
  getFeePriceId,
  upsertSubscription,
  applyCheckoutSessionOnce,
  getTenantIdBySubscriptionId,
  getAppIdBySubscriptionId,
  updateAppStatus,
  isTenantSubscriptionUpdateStale,
  resolvePlanFromSession,
  PLAN_SLOTS,
  PLAN_CREDITS,
  KNOWN_PLANS,
};
