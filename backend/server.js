const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { aiLimiter } = require('./middleware/rate-limit');
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');
const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const { callAiRouter, extractJsonFromAiContent, AiRouterError, AiRouterConfigError } = require('./lib/ai-router');
const { planRank, resolveAppStatusFromStripeStatus, isStaleEvent } = require('./lib/stripe-webhook-logic');

const app = express();
const PORT = process.env.PORT || 5005;

// Configurazione CORS
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
const isDevelopment = process.env.NODE_ENV !== 'production';

app.use(cors({
  origin: (origin, callback) => {
    // In development, permetti tutti gli origin
    if (isDevelopment) {
      return callback(null, true);
    }
    
    // In production, controlla la whitelist. Passare un Error al callback
    // (invece di `false`) fa propagare l'errore alla error-handling chain di
    // Express: senza un handler dedicato per gli errori CORS, QUALUNQUE
    // richiesta con un Origin non whitelisted (praticamente ogni chiamata
    // da browser) finiva con un 500 generico invece di un rifiuto CORS
    // pulito — mascherando il vero problema (whitelist non aggiornata) con
    // un errore che sembrava un crash lato server.
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log(`[CORS] Origin bloccato: ${origin}`);
      callback(null, false);
    }
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true
}));

app.use(helmet());

// Stripe webhook raw body handler DEVE essere prima di express.json()
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, { apiVersion: '2026-06-24.dahlia' }) : null;

function getStripe() {
  if (!stripe) throw new Error('Stripe non configurato');
  return stripe;
}

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );
}

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

// planRank ora importato da ./lib/stripe-webhook-logic (Fase 3, Step 3):
// era duplicato identico qui e in routes/stripe.js, unica fonte di verità.

// Somma slot/crediti e (opzionalmente) aggiorna il piano del tenant una sola
// volta per checkout session, indipendentemente da quale dei punti di sync
// (webhook, pagina /success, banner dashboard) la processa per primo o se
// Stripe re-invia lo stesso evento webhook. Il modello degli slot è cumulativo
// (vedi supabase_migrations/20260722_update_tenants_slots_cumulative.sql),
// quindi senza questa guardia una stessa sessione sommerebbe slot/crediti più
// volte.
// `creditsToAdd`/`userId`: i crediti Vision sono legati all'utente che ha
// pagato (profiles.user_id), non al tenant/workspace — coerenti con come
// vengono spesi in frontend/app/api/generate-video. Se creditsToAdd > 0 ma
// userId manca (non dovrebbe succedere: create-checkout-session imposta
// sempre supabase_user_id nei metadata) si salta solo l'accredito invece di
// far fallire l'intera sincronizzazione di slot/piano.
async function applyCheckoutSessionOnce(supabase, sessionId, tenantId, plan, slotsToAdd, creditsToAdd = 0, userId = null) {
  const { error: insertError } = await supabase
    .from('processed_checkout_sessions')
    .insert({ session_id: sessionId, tenant_id: tenantId, plan: plan || 'credit_topup', slots_added: slotsToAdd });

  if (insertError) {
    if (insertError.code === '23505') {
      console.log(`[Stripe Webhook] sessione ${sessionId} già processata, skip`);
      return false;
    }
    throw insertError;
  }

  if (creditsToAdd > 0) {
    if (userId) {
      const { error: creditsError } = await supabase.rpc('grant_credits', {
        p_user_id: userId,
        p_amount: creditsToAdd,
        p_type: 'purchase',
        p_description: `Acquisto piano ${plan || 'credit_topup'}`,
        p_reference_id: sessionId,
        p_metadata: { plan_id: plan || 'credit_topup', session_id: sessionId },
      });
      if (creditsError) {
        console.error('[Stripe Webhook] errore accredito crediti Vision:', creditsError);
      } else {
        console.log(`[Stripe Webhook] accreditati ${creditsToAdd} crediti Vision a utente ${userId}`);
      }
    } else {
      console.error(`[Stripe Webhook] impossibile accreditare crediti: supabase_user_id mancante nei metadata (session ${sessionId})`);
    }
  }

  if (slotsToAdd > 0) {
    const { error: rpcError } = await supabase.rpc('add_tenant_slots', {
      tenant_id: tenantId,
      slots_to_add: slotsToAdd,
    });
    if (rpcError) throw rpcError;
  }

  if (plan) {
    const { data: currentTenant } = await supabase
      .from('tenants')
      .select('plan')
      .eq('id', tenantId)
      .single();

    if (planRank(plan) >= planRank(currentTenant?.plan)) {
      const { error: planError } = await supabase
        .from('tenants')
        .update({ plan, updated_at: new Date().toISOString() })
        .eq('id', tenantId);
      if (planError) throw planError;
    } else {
      console.log(`[Stripe Webhook] piano ${plan} non applicato: tenant ${tenantId} ha già ${currentTenant?.plan}`);
    }
  }

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
// Prima di questa fase, past_due/canceled/rinnovo per l'abbonamento del
// cliente finale di un'app erano gestiti SOLO in
// frontend/app/api/webhooks/stripe/route.ts — endpoint non più configurato
// come webhook attivo su Stripe Dashboard in produzione (vedi commento in
// testa a quel file), lasciato vivo solo per backend/scripts/
// e2e_lifecycle_test.js. Qui si porta la stessa logica (stessa mappa stati)
// nel webhook autoritativo, senza toccare/rimuovere quel file.
//
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

// resolveAppStatusFromStripeStatus (mappa stati) ora importata da
// ./lib/stripe-webhook-logic.

// Un semplice UPDATE di stato è idempotente per costruzione (riapplicare lo
// stesso status non ha effetti diversi da applicarlo una volta sola): a
// differenza della grant di slot/crediti del ramo reseller sotto, qui non
// serve una guardia processed_checkout_sessions.
//
// eventCreatedAt (Fase 3, Step 3 — caso 13, eventi fuori ordine): il campo
// `created` dell'Event Stripe che ha scatenato questo update. Se la riga ha
// già un updated_at più recente di questo evento, l'evento è fuori ordine
// (es. una cancellazione arrivata in ritardo rispetto a un rinnovo già
// applicato) e viene scartato invece di sovrascrivere uno stato più recente.
async function updateAppStatus(supabase, appId, status, eventCreatedAt, extra = {}) {
  const { data: current } = await supabase
    .from('apps')
    .select('updated_at')
    .eq('id', appId)
    .maybeSingle();

  if (isStaleEvent(eventCreatedAt, current?.updated_at)) {
    console.log(`[Stripe Webhook] evento fuori ordine ignorato per app ${appId} (status richiesto: ${status})`);
    return false;
  }

  const { error } = await supabase
    .from('apps')
    .update({ status, updated_at: new Date().toISOString(), ...extra })
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
    if (!priceId) return metadataPlan || 'starter';
    const price = await stripe.prices.retrieve(priceId);
    const productId = typeof price.product === 'string' ? price.product : price.product?.id;
    if (!productId) return metadataPlan || 'starter';
    const product = await stripe.products.retrieve(productId);
    const name = (product.name || '').toLowerCase();
    if (name.includes('business')) return 'business';
    if (name.includes('vip')) return 'vip';
    if (name.includes('pro')) return 'pro';
    if (name.includes('starter')) return 'starter';
    if (name.includes('basic') || name.includes('base')) return 'basic';
    return metadataPlan || 'starter';
  } catch (err) {
    console.error('[resolvePlanFromSession] errore:', err);
    return metadataPlan || 'starter';
  }
}

app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) {
    console.error('[Stripe Webhook] STRIPE_SECRET_KEY non configurata');
    return res.status(503).json({ error: 'Stripe non configurato' });
  }

  const payload = req.body;
  const signature = req.headers['stripe-signature'] || '';

  let event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, stripeWebhookSecret);
  } catch (err) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  const supabase = getSupabase();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;

        // Abbonamento mensile app-cliente (paywall trial), creato da
        // /api/a/[slug]/create-checkout-session con metadata.app_id: va
        // gestito PRIMA di risolvere tenantId sotto, perché per queste
        // sessioni client_reference_id è l'id dell'APP, non del tenant —
        // altrimenti finirebbe trattata come un acquisto di piano reseller
        // con un tenantId inesistente (silenziosamente ignorata, "tenant non
        // trovato").
        const appId = session.metadata?.app_id || null;
        if (appId) {
          const appSubscriptionId = typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id || null;
          await updateAppStatus(supabase, appId, 'active', event.created, appSubscriptionId ? { stripe_subscription_id: appSubscriptionId } : {});
          console.log(`[Stripe Webhook] App ${appId} attivata (subscription ${appSubscriptionId || 'n/d'})`);
          break;
        }

        const tenantId = session.client_reference_id || session.metadata?.tenant_id;
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
        // Dalla ristrutturazione Invoice di Stripe (metà 2025), invoice.subscription
        // non esiste più: l'id sta sotto invoice.parent.subscription_details.subscription.
        // Il fallback sul campo legacy resta per compatibilità con payload più vecchi.
        const subscriptionId = invoice.parent?.subscription_details?.subscription || invoice.subscription;
        if (!subscriptionId) break;

        // Rinnovo di un abbonamento app-cliente: controllato prima del ramo
        // reseller sotto, le due tabelle non si sovrappongono mai sullo
        // stesso stripe_subscription_id.
        const paidAppId = await getAppIdBySubscriptionId(supabase, subscriptionId);
        if (paidAppId) {
          await updateAppStatus(supabase, paidAppId, 'active', event.created);
          console.log(`[Stripe Webhook] Rinnovo pagato per app ${paidAppId}`);
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
        const subscriptionId = invoice.subscription;
        if (!subscriptionId) break;

        const failedAppId = await getAppIdBySubscriptionId(supabase, subscriptionId);
        if (failedAppId) {
          await updateAppStatus(supabase, failedAppId, 'past_due', event.created);
          console.log(`[Stripe Webhook] Pagamento fallito per app ${failedAppId}`);
          break;
        }

        const tenantId = await getTenantIdBySubscriptionId(supabase, subscriptionId);
        if (!tenantId) break;

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
        const subscriptionId = subscription.id;

        const deletedAppId = await getAppIdBySubscriptionId(supabase, subscriptionId);
        if (deletedAppId) {
          await updateAppStatus(supabase, deletedAppId, 'canceled', event.created);
          console.log(`[Stripe Webhook] Subscription cancellata per app ${deletedAppId}`);
          break;
        }

        const tenantId = await getTenantIdBySubscriptionId(supabase, subscriptionId);
        if (!tenantId) break;

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
        const subscriptionId = subscription.id;

        const updatedAppId = await getAppIdBySubscriptionId(supabase, subscriptionId);
        if (updatedAppId) {
          const newAppStatus = resolveAppStatusFromStripeStatus(subscription.status);
          if (newAppStatus) {
            await updateAppStatus(supabase, updatedAppId, newAppStatus, event.created);
            console.log(`[Stripe Webhook] App ${updatedAppId} sincronizzata a '${newAppStatus}'`);
          }
          break;
        }

        const tenantId = await getTenantIdBySubscriptionId(supabase, subscriptionId);
        if (!tenantId) break;

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
        const tenantId = paymentIntent.metadata?.tenant_id;
        const planId = paymentIntent.metadata?.plan_id;
        const quantity = parseInt(paymentIntent.metadata?.quantity || '1', 10);
        const feePriceId = paymentIntent.metadata?.fee_price_id;
        const supabaseUserId = paymentIntent.metadata?.supabase_user_id || null;

        if (!tenantId) {
          break;
        }

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
        // idempotente su paymentIntent.id
        if (planId === 'credit_topup') {
          try {
            const creditsToAdd = (PLAN_CREDITS.credit_topup || 0) * quantity;
            const slotsToAdd = (PLAN_SLOTS.credit_topup || 0) * quantity;
            const applied = await applyCheckoutSessionOnce(supabase, paymentIntent.id, tenantId, null, slotsToAdd, creditsToAdd, supabaseUserId);
            if (applied) {
              console.log(`[Stripe Webhook] +${creditsToAdd} crediti Vision e +${slotsToAdd} slot (ricarica extra) per tenant ${tenantId}`);
            }
          } catch (err) {
            console.error(`[Stripe Webhook] errore accredito crediti per credit_topup`, err);
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

    return res.json({ received: true });
  } catch (err) {
    console.error('Errore webhook Stripe:', err);
    res.status(500).json({ error: 'Errore webhook' });
  }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Client AI inizializzati solo se le chiavi sono presenti — usati solo da
// /api/vision/analyze (input multimodale, non ancora supportato dall'AI
// Router centralizzato in ./lib/ai-router.js). /api/chat e /api/generate-app
// usano invece callAiRouter (OpenRouter), vedi sotto.
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

function clientMissing(res, provider) {
  return res.status(503).json({ error: `${provider} non configurato. Aggiungi la chiave API.` });
}

// Le route AI sotto (chat, vision, generate-app) chiamano provider a pagamento
// (OpenRouter via ./lib/ai-router.js per chat/generate-app; Groq/OpenAI/Gemini
// diretti per vision) con le chiavi del proprietario del sito: senza
// autenticazione chiunque conoscesse l'URL del backend potrebbe consumare
// budget illimitato. Accetta sia un JWT Supabase reale (chiamata diretta dal
// browser) sia il BACKEND_SERVICE_TOKEN condiviso + X-User-ID (stesso schema
// di routes/stripe.js::getUser, per le chiamate server-to-server dal
// frontend Next.js che già autentica l'utente a monte).
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const serviceToken = process.env.BACKEND_SERVICE_TOKEN;

  if (serviceToken && authHeader === `Bearer ${serviceToken}`) {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'x-user-id mancante' });
    req.user = { id: userId, email: req.headers['x-user-email'] };
    return next();
  }

  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Autenticazione richiesta' });

  try {
    const supabase = getSupabase();
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Token non valido' });
    req.user = user;
    next();
  } catch (err) {
    console.error('[requireAuth] errore:', err);
    res.status(401).json({ error: 'Token non valido' });
  }
}

// --- HEALTH CHECK ---
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- CHAT API ---
// Assistente conversazionale generico: task "chat" -> tier "fast" dell'AI
// Router centralizzato (./lib/ai-router.js), nessuna generazione complessa di
// app/codice qui.
app.post('/api/chat', requireAuth, aiLimiter, async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array richiesto' });
    }

    const { content: reply } = await callAiRouter({
      task: 'chat',
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      context: { userId: req.user?.id },
    });
    return res.json({ reply });
  } catch (err) {
    console.error('/api/chat error:', err);
    if (err instanceof AiRouterConfigError) {
      return res.status(500).json({ error: 'Servizio AI non configurato correttamente. Contatta il supporto.' });
    }
    if (err instanceof AiRouterError) {
      return res.status(502).json({ error: 'Errore interno' });
    }
    res.status(500).json({ error: 'Errore interno' });
  }
});

// --- VISION API ---
app.post('/api/vision/analyze', requireAuth, aiLimiter, async (req, res) => {
  try {
    const { prompt, image, provider = 'groq', model } = req.body;
    if (!image) return res.status(400).json({ error: 'Immagine richiesta' });

    const base64Image = image.includes(',') ? image.split(',')[1] : image;
    const mimeType = image.includes('data:image/png') ? 'image/png' : 'image/jpeg';

    if (provider === 'groq') {
      if (!groq) return clientMissing(res, 'Groq');
      const visionModel = model || 'meta-llama/llama-4-scout-17b-16e-instruct';
      const completion = await groq.chat.completions.create({
        model: visionModel,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt || 'Descrivi questa immagine dettagliatamente.' },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
            ]
          }
        ]
      });
      return res.json({ reply: completion.choices[0].message.content });
    }

    if (provider === 'gemini') {
      if (!genAI) return clientMissing(res, 'Gemini');
      const geminiModel = genAI.getGenerativeModel({ model: model || 'gemini-1.5-flash' });
      const result = await geminiModel.generateContent([
        prompt || 'Descrivi questa immagine.',
        { inlineData: { data: base64Image, mimeType } }
      ]);
      return res.json({ reply: result.response.text() });
    }

    if (provider === 'openai') {
      if (!openai) return clientMissing(res, 'OpenAI');
      const completion = await openai.chat.completions.create({
        model: model || 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt || 'Descrivi questa immagine.' },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
            ]
          }
        ]
      });
      return res.json({ reply: completion.choices[0].message.content });
    }

    return res.status(400).json({ error: `Provider ${provider} non supportato per vision` });
  } catch (err) {
    console.error('/api/vision/analyze error:', err);
    res.status(500).json({ error: 'Errore vision' });
  }
});

// --- GENERATE APP BLUEPRINT ---
app.post('/api/generate-app', requireAuth, aiLimiter, async (req, res) => {
  try {
    const { sector, tenantId } = req.body;
    if (!sector) return res.status(400).json({ error: 'Settore richiesto' });

    // Carica design system per il settore
    const { getDesignSystemForSector } = require('./utils/designSystemLoader');
    const designSystem = getDesignSystemForSector(sector);
    
    const prompt = `Sei un architetto software. Genera un blueprint JSON per un gestionale SaaS per il settore "${sector}".

${designSystem.designContent ? `## DESIGN SYSTEM DA APPLICARE\n${designSystem.designContent}\n` : ''}

Il JSON deve contenere:
- appName: nome dell'app
- sector: settore normalizzato in kebab-case
- description: descrizione breve
- schema: { tables: [{ name, label, labelPlural, icon, fields: [{ id, type, label, required, options, target, targetLabel }] }] }
- ui: { 
  primaryColor: "${designSystem.designTokens?.colors?.primary || '#6366f1'}",
  secondaryColor: "${designSystem.designTokens?.colors?.secondary || '#a855f7'}",
  background: "${designSystem.designTokens?.colors?.background || '#ffffff'}",
  surface: "${designSystem.designTokens?.colors?.surface || '#ffffff'}",
  headlineFont: "${designSystem.designTokens?.typography?.headline || 'Inter'}",
  bodyFont: "${designSystem.designTokens?.typography?.body || 'Inter'}",
  sidebar: [], 
  dashboardCards: [{ type, table, label, field }] 
}

Rispondi SOLO con il JSON valido, senza testo aggiuntivo.`;

    console.log('[generate-app] sector:', sector);

    // Generazione completa di una nuova app da zero: task "app-generation" ->
    // tier "advanced" dell'AI Router centralizzato (es. Claude Sonnet 5).
    const { content: raw } = await callAiRouter({
      task: 'app-generation',
      jsonMode: true,
      messages: [{ role: 'user', content: prompt }],
      context: { tenantId },
    });
    const parsed = extractJsonFromAiContent(raw);

    // Normalizza al formato BlueprintJSON atteso
    const blueprint = {
      appName: parsed.appName || parsed.name || `App ${sector}`,
      sector: parsed.sector || sector.toLowerCase().replace(/\s+/g, '-'),
      description: parsed.description || '',
      schema: parsed.schema || { tables: [] },
      ui: parsed.ui || { 
        primaryColor: designSystem.designTokens?.colors?.primary || '#6366f1',
        secondaryColor: designSystem.designTokens?.colors?.secondary || '#a855f7',
        background: designSystem.designTokens?.colors?.background || '#ffffff',
        surface: designSystem.designTokens?.colors?.surface || '#ffffff',
        sidebarBg: designSystem.designTokens?.colors?.sidebarBg || '#1e293b',
        headlineFont: designSystem.designTokens?.typography?.headline || 'Inter',
        bodyFont: designSystem.designTokens?.typography?.body || 'Inter',
        sidebar: [], 
        dashboardCards: [] 
      },
    };

    console.log('[generate-app] Blueprint generato per settore:', sector, 'design:', designSystem.designContent ? 'loaded' : 'default');

    return res.json({ blueprint, tenantId });
  } catch (err) {
    console.error('/api/generate-app error:', err);
    if (err instanceof AiRouterConfigError) {
      return res.status(500).json({ error: 'Servizio AI non configurato correttamente. Contatta il supporto.' });
    }
    if (err instanceof AiRouterError) {
      return res.status(502).json({ error: 'Errore interno' });
    }
    res.status(500).json({ error: 'Errore generazione blueprint' });
  }
});

// --- STRIPE ROUTES (checkout e billing) ---
app.use('/api', require('./routes/stripe'));
app.use('/api', require('./routes/client-app'));

// --- APP RECORDS ROUTES (CRUD dati app) ---
app.use('/api', require('./routes/app-records'));

// --- CUSTOM TABLES ROUTES (tabelle personalizzate utente) ---
app.use('/api', require('./routes/custom-tables'));

// --- INVOICES ROUTES (fatturazione) ---
app.use('/api', require('./routes/invoices'));

// --- GENERATE ROUTE (Totalium Dynamic UI) ---
app.use('/api', require('./routes/generate'));

// --- APP REGISTRY ROUTES (Management Console) ---
app.use('/api', require('./routes/app-registry'));

// --- ERROR HANDLER ---
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Errore interno del server' });
});

// Cron job per controllo scadenze app
const { startExpiryCheck } = require('./jobs/expiry-check');
startExpiryCheck();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ ShardApps backend attivo su http://0.0.0.0:${PORT}`);
});
