const express = require('express');
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { checkoutLimiter } = require('../middleware/rate-limit');
const { PLAN_RANK } = require('../lib/stripe-webhook-logic');
const { authorizeUpdateAppFee, authorizeSyncPlan } = require('../lib/stripe-route-authorization');

const router = express.Router();
const STRIPE_API_VERSION = '2025-03-31.basil';

// Seam di test (audit /sync-plan, 2026-08-11): getSupabase/getStripe
// costruiscono client reali leggendo le env var ad ogni chiamata —
// comportamento invariato in produzione, dove __setTestClients non viene
// mai invocato. lib/stripe-webhook-handler.js riceve supabase/stripe come
// parametri di handleStripeWebhookEvent(...) proprio per essere testabile
// end-to-end senza rete reale; qui la route li costruisce internamente
// (Express non passa dipendenze ai singoli handler), quindi l'unico punto
// di innesto minimale per lo stesso tipo di test è un override esplicito.
let _testSupabaseOverride = null;
let _testStripeOverride = null;
function __setTestClients({ supabase = null, stripe = null } = {}) {
  _testSupabaseOverride = supabase;
  _testStripeOverride = stripe;
}

function getSupabase() {
  return _testSupabaseOverride || createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );
}

function getStripe() {
  return _testStripeOverride || new Stripe(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: STRIPE_API_VERSION,
  });
}

// PLAN_RANK ora importato da ../lib/stripe-webhook-logic (Fase 3, Step 3 +
// audit /sync-plan 2026-08-11): era duplicato identico qui e in server.js,
// unica fonte di verità — passato così com'è a apply_checkout_session_atomic
// (vedi sotto), che lo usa per lo stesso confronto anti-downgrade prima
// fatto qui in JS con planRank().

// Crediti Vision e slot accreditati da una "Ricarica Extra" (credit_topup),
// vedi anche PLAN_CREDITS.credit_topup / PLAN_SLOTS.credit_topup in
// backend/server.js.
const CREDIT_TOPUP_CREDITS = 50;
const CREDIT_TOPUP_SLOTS = 1;

// Price ID della fee ricorrente mensile per app attiva, stessi valori di
// backend/server.js::getFeePriceId e frontend/app/api/create-checkout-session.
function getFeePriceId(planId) {
  const feePrices = {
    starter: process.env.STRIPE_FEE_PRICE_STARTER || 'price_1TmdIgRZR2YaFu2sT5gkrMdx',
    pro: process.env.STRIPE_FEE_PRICE_PRO || 'price_1TmdK0RZR2YaFu2s8pXkLety',
    business: process.env.STRIPE_FEE_PRICE_BUSINESS || 'price_1TmdKuRZR2YaFu2sHeH8fShE',
  };
  return feePrices[planId] || feePrices.starter;
}

async function getUser(req) {
  const authHeader = req.headers.authorization;
  const serviceToken = process.env.BACKEND_SERVICE_TOKEN;

  if (serviceToken && authHeader === `Bearer ${serviceToken}`) {
    const userId = req.headers['x-user-id'];
    const userEmail = req.headers['x-user-email'];
    if (!userId) return null;
    return { id: userId, email: userEmail };
  }

  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  const supabase = getSupabase();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

async function getOrCreateTenant(supabase, user, accessToken) {
  const { data: membership } = await supabase
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();

  if (membership) return membership.tenant_id;

  const { data: tenant } = await supabase
    .from('tenants')
    .insert({
      owner_id: user.id,
      name: user.email ? `Tenant di ${user.email}` : 'Tenant personale',
      slug: `tenant-${user.id.slice(0, 8)}`,
      plan: 'free',
      app_limit: 0,
    })
    .select('id')
    .single();

  if (!tenant) throw new Error('Errore creazione tenant');

  await supabase.from('tenant_members').insert({ tenant_id: tenant.id, user_id: user.id, role: 'owner' });

  ensureComandiProvisioned(accessToken);

  return tenant.id;
}

// Comandi AI è un'app omaggio inclusa di default in ogni tenant (non
// consuma slot, vedi frontend/app/actions/comandi-provisioning.ts). Questo
// backend Express è un processo separato dal frontend Next.js: non può
// importare la Server Action direttamente, quindi la invoca via HTTP sul
// wrapper dedicato (frontend/app/api/comandi/provision/route.ts).
// Fire-and-forget: un fallimento non deve mai bloccare la creazione del
// tenant/checkout, che è il compito primario di questa route.
function ensureComandiProvisioned(accessToken) {
  const frontendUrl = process.env.FRONTEND_URL;
  if (!frontendUrl || !accessToken) return;

  fetch(`${frontendUrl}/api/comandi/provision`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error('[getOrCreateTenant] Provisioning Comandi AI non riuscito:', res.status, body);
      }
    })
    .catch((err) => console.error('[getOrCreateTenant] Errore provisioning Comandi AI:', err));
}

// POST /api/create-checkout-session è servito solo da
// frontend/app/api/create-checkout-session/route.ts (Managed Payments,
// testato end-to-end): il browser chiama sempre il path relativo, quindi
// questa route Express non veniva mai raggiunta (e aveva un bug proprio,
// quantity:0 su un line item ricorrente, rifiutato da Stripe). Rimossa
// insieme a getSetupPriceId/getFeePriceId/CREDIT_TOPUP_PRICE_ID, usate solo
// da questa route.

// POST /api/stripe/update-app-fee
router.post('/update-app-fee', checkoutLimiter, async (req, res) => {
  try {
    // Fase 3, Priorità 2: decisione (401/400/403) delegata a
    // authorizeUpdateAppFee (lib/stripe-route-authorization.js, testata con
    // node:test), stesso ordine/short-circuit di prima — la query su
    // tenant_members viene eseguita solo se utente/tenantId/action sono
    // già presenti.
    const user = await getUser(req);
    const { tenantId, action } = req.body; // action: 'increment' o 'decrement'
    const supabase = getSupabase();

    let membership = null;
    if (user && tenantId && action) {
      const { data } = await supabase
        .from('tenant_members')
        .select('tenant_id')
        .eq('tenant_id', tenantId)
        .eq('user_id', user.id)
        .single();
      membership = data;
    }

    const decision = authorizeUpdateAppFee({ user, tenantId, action, membership });
    if (!decision.ok) {
      return res.status(decision.status).json({ error: decision.error });
    }

    const stripe = getStripe();

    // Recupera subscription
    const { data: subData } = await supabase
      .from('subscriptions')
      .select('stripe_subscription_id, stripe_customer_id')
      .eq('tenant_id', tenantId)
      .single();

    if (!subData?.stripe_subscription_id) {
      return res.status(400).json({ error: 'Nessuna subscription attiva' });
    }

    // Recupera subscription da Stripe
    const subscription = await stripe.subscriptions.retrieve(subData.stripe_subscription_id);

    // Trova il line item della fee mensile
    const feeLineItem = subscription.items.data.find(item => {
      return item.price.metadata?.type === 'app_fee' || item.price.nickname?.toLowerCase().includes('fee');
    });

    if (!feeLineItem) {
      return res.status(400).json({ error: 'Line item fee non trovato' });
    }

    // La quantity non viene mai calcolata da un +1/-1 fornito dal client:
    // 'action' arriva da qualunque membro del tenant senza controllo di ruolo,
    // quindi un +1/-1 incondizionato permetterebbe di azzerare il canone
    // mensile chiamando 'decrement' più volte, indipendentemente dal numero
    // reale di app attive. Si ricalcola sempre la quantity dal conteggio
    // reale delle app del tenant (fonte di verità), rendendo l'endpoint
    // idempotente e non manipolabile: 'action' resta solo per log/compatibilità.
    //
    // Un'app entra nella quantity di questa fee solo se TUTTE le condizioni
    // sono vere:
    // 1. status != 'active' — le app con status:'active' hanno un cliente
    //    finale che paga tramite Stripe (vedi verify-checkout-session/route.ts,
    //    che imposta status:'active' + stripe_subscription_id al checkout
    //    del cliente): ShardApps incassa già la sua quota di 25€ trattenendola
    //    da quel pagamento (client_price - zeusx_fee = reseller_amount,
    //    vedi create-checkout-session dell'app). Altrimenti il reseller
    //    pagherebbe la stessa app due volte.
    // 2. owner_trial_ends_at IS NOT NULL — l'owner ha fatto almeno il primo
    //    login nell'app (vedi mark-first-login/route.ts, verify-password/
    //    route.ts, AuthContext.tsx). Se non ha mai fatto login, l'app non è
    //    ancora "in uso" e non deve generare alcun addebito.
    // 3. owner_trial_ends_at < now() — i 30 giorni di trial dal primo login
    //    sono scaduti (il trial è gestito qui via query, non su Stripe: una
    //    subscription a quantity variabile non supporta trial differenziati
    //    per unità con date di inizio diverse).
    // 4. product_id IS NULL (STEP 4, App Catalog) — una Catalog Instance
    //    (product_id valorizzato, STEP 3) NON è una "app pubblicata dal
    //    reseller a un proprio cliente": è fatturata direttamente al tenant
    //    con una propria subscription Stripe (apps.stripe_subscription_id,
    //    vedi /api/catalog/products/[productSlug]/checkout e il ramo 'app'
    //    del webhook esteso allo STEP 4). Senza questo filtro rischierebbe
    //    doppia fatturazione: se il tenant fa login nella propria Catalog
    //    Instance (owner_trial_ends_at viene comunque impostato da
    //    mark-first-login, che non distingue le Catalog Instance dalle app
    //    normali) e poi non la sottoscrive entro 30 giorni (status resta
    //    'trial', mai 'active' — quello lo diventa solo tramite il checkout
    //    Catalog dedicato, non verify-checkout-session), verrebbe altrimenti
    //    conteggiata qui E fatturata separatamente se sottoscritta più tardi.
    const { count: appCount, error: countError } = await supabase
      .from('apps')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .neq('status', 'active')
      .is('product_id', null)
      .not('owner_trial_ends_at', 'is', null)
      .lt('owner_trial_ends_at', new Date().toISOString());

    if (countError) {
      console.error('[update-app-fee] errore conteggio app:', countError);
      return res.status(500).json({ error: 'Errore conteggio app tenant' });
    }

    const newQuantity = appCount ?? 0;

    // Aggiorna subscription
    await stripe.subscriptions.update(subscription.id, {
      items: [{
        id: feeLineItem.id,
        quantity: newQuantity,
      }],
      proration_behavior: 'always_invoice',
    });

    console.log(`[update-app-fee] tenant ${tenantId}: quantity ${feeLineItem.quantity} -> ${newQuantity}`);

    return res.json({ success: true, newQuantity });
  } catch (err) {
    console.error('[update-app-fee] errore:', err);
    res.status(500).json({ error: 'Errore aggiornamento fee' });
  }
});

// POST /api/sync-plan
router.post('/sync-plan', async (req, res) => {
  try {
    // Fase 3, Priorità 2: decisione (401/400/403) delegata a
    // authorizeSyncPlan (lib/stripe-route-authorization.js, testata con
    // node:test), stesso ordine/short-circuit di prima: la sessione Stripe
    // viene recuperata solo se utente+sessionId sono già presenti, e la
    // query di fallback su tenants (owner_id) solo se la membership non è
    // stata trovata.
    const user = await getUser(req);
    const { sessionId } = req.body || {};

    const supabase = getSupabase();
    const stripe = getStripe();

    let tenantId = null;
    let session = null;
    if (user && sessionId) {
      session = await stripe.checkout.sessions.retrieve(sessionId);
      tenantId = session.client_reference_id || session.metadata?.tenant_id;
    }

    let membership = null;
    let tenantByOwner = null;
    if (tenantId) {
      const { data } = await supabase
        .from('tenant_members')
        .select('tenant_id')
        .eq('tenant_id', tenantId)
        .eq('user_id', user.id)
        .maybeSingle();
      membership = data;

      if (!membership) {
        // Stesso ordine di risoluzione di create-checkout-session (frontend):
        // un tenant trovato per owner_id non ha sempre una riga tenant_members
        // corrispondente — viene creata solo quando il tenant stesso viene
        // creato al momento del checkout, non quando esisteva già con
        // owner_id impostato in altro modo. Senza questo fallback, /sync-plan
        // rifiuta con 403 un pagamento legittimo: il piano viene comunque
        // aggiornato dal webhook (che risolve il tenant solo dal metadata),
        // ma l'utente non lo vede mai confermato/sincronizzato in app.
        const { data: ownerData } = await supabase
          .from('tenants')
          .select('id')
          .eq('id', tenantId)
          .eq('owner_id', user.id)
          .maybeSingle();
        tenantByOwner = ownerData;
      }
    }

    const decision = authorizeSyncPlan({ user, sessionId, tenantId, membership, tenantByOwner });
    if (!decision.ok) {
      return res.status(decision.status).json({ error: decision.error });
    }

    if (session.payment_status !== 'paid') {
      return res.json({ paid: false, plan: 'free', appLimit: 0, creditsAdded: 0 });
    }

    const metadataPlan = session.metadata?.plan_id;
    // I crediti Vision sono legati all'utente che ha pagato (profiles.user_id):
    // per sessioni create da questa stessa route i metadata contengono sempre
    // supabase_user_id; per compatibilità con sessioni più vecchie che ne
    // fossero prive, l'utente autenticato che chiama /sync-plan (verificato
    // come membro del tenant sopra) è comunque un fallback ragionevole.
    const supabaseUserId = session.metadata?.supabase_user_id || user.id;

    // "Ricarica Extra" (credit_topup, ex "extra_slot"): accredita crediti
    // Vision, zero slot, non è un "piano" — gestita a parte perché altrimenti
    // finirebbe nel fallback sotto e verrebbe trattata erroneamente come
    // acquisto del piano 'starter'.
    if (metadataPlan === 'credit_topup') {
      const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 10 });
      const quantity = lineItems.data[0]?.quantity || 1;
      const creditsToAdd = CREDIT_TOPUP_CREDITS * quantity;
      const slotsToAdd = CREDIT_TOPUP_SLOTS * quantity;

      // Marca processata + accredita crediti + somma slot come un'unica
      // transazione atomica (stessa RPC del webhook Stripe, vedi
      // backend/lib/stripe-webhook-handler.js::applyCheckoutSessionOnce e
      // supabase/migrations/20260811000000_atomic_checkout_session_
      // processing.sql). Prima erano 3 scritture separate: se grant_credits
      // falliva dopo l'INSERT di marcatura, l'errore veniva propagato qui
      // (500), MA la sessione restava comunque marcata come processata —
      // condividendo la stessa riga processed_checkout_sessions(session_id)
      // usata dal webhook, questo disinnescava anche il fix del webhook
      // (che vedeva la sessione "già processata" e faceva no-op, pur non
      // avendo mai davvero completato l'accredito). Ora, chiunque dei due
      // percorsi arrivi per primo su questa session_id, o completa TUTTO
      // atomicamente o non marca nulla — l'altro percorso può sempre
      // ritentare con successo.
      const { error: applyError } = await supabase.rpc('apply_checkout_session_atomic', {
        p_session_id: sessionId,
        p_tenant_id: tenantId,
        p_plan: null,
        p_slots_to_add: slotsToAdd,
        p_credits_to_add: creditsToAdd,
        p_user_id: supabaseUserId,
        p_plan_rank_map: PLAN_RANK,
      });

      if (applyError) {
        console.error('[sync-plan] errore apply_checkout_session_atomic (credit_topup):', applyError);
        return res.status(500).json({ error: 'Errore ricarica crediti' });
      }

      const { data: tenantRow } = await supabase
        .from('tenants')
        .select('plan, app_limit')
        .eq('id', tenantId)
        .single();

      return res.json({
        paid: true,
        plan: tenantRow?.plan ?? null,
        appLimit: tenantRow?.app_limit ?? 0,
        creditsAdded: creditsToAdd,
      });
    }

    const planConfig = {
      starter: { appLimit: 1, credits: 20 },
      pro: { appLimit: 5, credits: 100 },
      business: { appLimit: 50, credits: 500 }
    };

    // Il piano scelto è già salvato correttamente in metadata.plan_id al
    // momento della creazione della sessione — stessa fonte usata dal
    // webhook Stripe. Prima si re-indovinava dal nome del prodotto Stripe
    // (business/pro/starter come sottostringa): se il nome conteneva "pro"
    // per qualunque motivo, QUALSIASI piano diverso da "business" veniva
    // salvato come "pro", sovrascrivendo il valore corretto già scritto dal
    // webhook. Il match sul nome resta solo come fallback per sessioni
    // vecchie prive di questo metadata.
    let plan = planConfig[metadataPlan] ? metadataPlan : 'starter';
    let appLimit = planConfig[plan]?.appLimit ?? 1;
    let creditsToAdd = planConfig[plan]?.credits ?? 0;

    if (!metadataPlan) {
      const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 10 });
      const priceId = lineItems.data[0]?.price?.id;

      if (priceId) {
        const price = await stripe.prices.retrieve(priceId);
        const productId = typeof price.product === 'string' ? price.product : price.product?.id;

        if (productId) {
          const product = await stripe.products.retrieve(productId);
          const name = (product.name || '').toLowerCase();

          if (name.includes('business')) {
            plan = 'business';
          } else if (name.includes('pro')) {
            plan = 'pro';
          } else if (name.includes('starter')) {
            plan = 'starter';
          }
          appLimit = planConfig[plan]?.appLimit ?? 1;
          creditsToAdd = planConfig[plan]?.credits ?? 0;
        }
      }
    }

    // Marca processata + accredita crediti + somma slot + aggiorna piano
    // come un'unica transazione atomica (stessa RPC del webhook Stripe, vedi
    // backend/lib/stripe-webhook-handler.js::applyCheckoutSessionOnce e
    // supabase/migrations/20260811000000_atomic_checkout_session_
    // processing.sql). Prima erano 4 scritture separate su questa stessa
    // guardia di idempotenza (processed_checkout_sessions), condivisa con il
    // webhook: se grant_credits falliva qui, l'errore veniva SOLO loggato
    // (mai propagato, mai un 500) e la sessione restava comunque marcata
    // come processata — non solo un cliente pagante restava senza crediti,
    // ma la stessa riga session_id impediva anche al webhook (già corretto
    // e atomico) di completare l'operazione più tardi, perché la trovava
    // "già processata" e faceva no-op. Ora, chiunque dei due percorsi arrivi
    // per primo, o completa TUTTO atomicamente o non marca nulla — l'altro
    // percorso può sempre ritentare con successo. `applied` sostituisce il
    // vecchio `!insertError` come guardia per il blocco sotto (fee
    // subscription): va eseguito solo la prima volta che QUESTA chiamata
    // processa davvero la sessione, non su un retry/duplicato.
    const { data: applied, error: applyError } = await supabase.rpc('apply_checkout_session_atomic', {
      p_session_id: sessionId,
      p_tenant_id: tenantId,
      p_plan: plan,
      p_slots_to_add: appLimit,
      p_credits_to_add: creditsToAdd,
      p_user_id: supabaseUserId,
      p_plan_rank_map: PLAN_RANK,
    });

    if (applyError) {
      console.error('[sync-plan] errore apply_checkout_session_atomic:', applyError);
      return res.status(500).json({ error: 'Errore aggiornamento piano' });
    }

    if (applied) {
      // Crea la fee subscription (25€/app, quantity incrementata da
      // /update-app-fee man mano che il tenant attiva app). Le sessioni di
      // checkout sono in mode:'payment' (Managed Payments), quindi non hanno
      // mai una session.subscription: la fee subscription va creata a parte
      // qui, non nel webhook checkout.session.completed (che infatti si
      // fermava prima su "subscription id mancante" e non la creava mai).
      // Una sola fee subscription per tenant: se esiste già una riga in
      // "subscriptions" non se ne crea un'altra.
      const { data: existingSub } = await supabase
        .from('subscriptions')
        .select('stripe_subscription_id')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (!existingSub?.stripe_subscription_id) {
        try {
          const feePriceId = getFeePriceId(plan);
          const feeSubscription = await stripe.subscriptions.create({
            customer: session.customer,
            items: [{ price: feePriceId, quantity: 0 }], // Inizia da 0, verrà incrementata con le app
            metadata: { tenant_id: tenantId, type: 'app_fee' },
            proration_behavior: 'always_invoice',
            // Niente trial_period_days qui: il trial è per singola app (dal
            // primo login dell'owner, vedi apps.owner_trial_ends_at), non
            // sull'intera subscription del tenant — Stripe non supporta
            // trial differenziati per unità in una subscription a quantity
            // variabile. Il trial è applicato lato query in /update-app-fee.
          });

          // Dalla API version in uso, current_period_start/end non sono più
          // sulla subscription ma sul subscription item (Stripe ha spostato
          // questi campi a livello di item da metà 2025).
          const feeSubItem = feeSubscription.items.data[0];
          const { error: subUpsertError } = await supabase
            .from('subscriptions')
            .upsert(
              {
                tenant_id: tenantId,
                stripe_customer_id: session.customer,
                stripe_subscription_id: feeSubscription.id,
                status: feeSubscription.status,
                current_period_start: new Date(feeSubItem.current_period_start * 1000).toISOString(),
                current_period_end: new Date(feeSubItem.current_period_end * 1000).toISOString(),
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'tenant_id' }
            );

          if (subUpsertError) {
            console.error('[sync-plan] errore salvataggio fee subscription:', subUpsertError);
          } else {
            console.log(`[sync-plan] Fee subscription creata: ${feeSubscription.id} per tenant ${tenantId}`);
          }
        } catch (feeErr) {
          console.error('[sync-plan] errore creazione fee subscription:', feeErr);
        }
      }
    }

    const { data: tenantRow } = await supabase
      .from('tenants')
      .select('plan, app_limit')
      .eq('id', tenantId)
      .single();

    return res.json({
      paid: true,
      plan: tenantRow?.plan ?? plan,
      appLimit: tenantRow?.app_limit ?? appLimit,
      creditsAdded: creditsToAdd,
    });
  } catch (err) {
    console.error('[sync-plan] errore:', err);
    res.status(500).json({ error: 'Errore sync piano' });
  }
});

module.exports = router;
// Esposto solo per i test E2E (backend/lib/stripe-sync-plan-route.test.js) —
// mai chiamato da codice di produzione.
module.exports.__setTestClients = __setTestClients;
