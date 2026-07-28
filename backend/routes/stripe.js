const express = require('express');
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();
const STRIPE_API_VERSION = '2026-06-24.dahlia';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );
}

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: STRIPE_API_VERSION,
  });
}

// Rango dei piani: gli eventi Stripe (webhook, /sync-plan, banner dashboard)
// non arrivano garantiti in ordine cronologico. Se un tenant compra business
// e poi (per un evento in ritardo) arriva l'evento del vecchio acquisto
// starter, un update incondizionato di tenants.plan lo farebbe retrocedere.
// Confrontando il rango si applica solo un piano pari o superiore a quello
// già salvato.
const PLAN_RANK = { free: 0, starter: 1, basic: 1, pro: 2, business: 3, vip: 3 };
function planRank(plan) {
  return PLAN_RANK[plan] ?? 0;
}

// Crediti Vision accreditati da una "Ricarica Extra" (credit_topup), vedi
// anche PLAN_CREDITS.credit_topup in backend/server.js.
const CREDIT_TOPUP_CREDITS = 50;

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

// Setup (one-time) price ID per piano. Non fidarsi mai del priceId passato
// dal client: planId decide quanti slot vengono concessi dal webhook, quindi
// il prezzo addebitato deve essere derivato server-side dallo stesso planId
// (stessa vulnerabilità già corretta in frontend/app/api/create-checkout-session/route.ts).
function getSetupPriceId(planId) {
  const setupPrices = {
    starter: process.env.STRIPE_SETUP_PRICE_STARTER || 'price_1TwTvdRZR2YaFu2sUdqjbupl',
    pro: process.env.STRIPE_SETUP_PRICE_PRO || 'price_1Tmd1tRZR2YaFu2sgHgxzcTC',
    business: process.env.STRIPE_SETUP_PRICE_BUSINESS || 'price_1Tmd4GRZR2YaFu2s0FZ4Btym',
  };
  return setupPrices[planId] || null;
}

// Nome storico della env var (il bottone si chiamava "Slot Extra" e dava +1
// slot app): stesso Price Stripe da 15€, ora "Ricarica Extra" accredita
// crediti Vision invece di uno slot, quindi non serve un nuovo Price né
// rinominare la env var.
const CREDIT_TOPUP_PRICE_ID = process.env.EXTRA_SLOT_PRICE_ID || process.env.NEXT_PUBLIC_EXTRA_SLOT_PRICE_ID || 'price_extra_slot_15';

// POST /api/create-checkout-session
router.post('/create-checkout-session', async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Non autorizzato' });

  try {
    const { planId, quantity = 1 } = req.body;
    const priceId = planId === 'credit_topup' ? CREDIT_TOPUP_PRICE_ID : getSetupPriceId(planId);
    if (!priceId) return res.status(400).json({ error: 'Piano non riconosciuto' });

    const supabase = getSupabase();
    const authHeader = req.headers.authorization;
    const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const tenantId = await getOrCreateTenant(supabase, user, accessToken);

    const stripe = getStripe();

    // Crea o recupera customer
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    let customerId = customers.data[0]?.id;

    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email });
      customerId = customer.id;
    }

    // Attach payment method
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
    });

    const appUrl = process.env.APP_URL || 'https://zeusx-zwu8.vercel.app';

    // Line items: setup + fee mensile (quantity=0 iniziale)
    const feePriceId = getFeePriceId(planId);
    const lineItems = [];

    // Handle credit top-up purchase ("Ricarica Extra")
    if (planId === 'credit_topup') {
      lineItems.push({ price: priceId, quantity: quantity });
    } else {
      // Regular plan: setup + monthly fee
      lineItems.push({ price: priceId, quantity: 1 }); // Setup one-time
      if (feePriceId) {
        lineItems.push({ price: feePriceId, quantity: 0 }); // Fee mensile, quantity aggiornata dopo
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: lineItems,
      success_url: `${appUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/pricing`,
      client_reference_id: tenantId,
      // supabase_user_id: i crediti Vision (grant_credits) sono legati
      // all'utente che paga (profiles.user_id), non al tenant/workspace —
      // senza questo campo il webhook non saprebbe a chi accreditarli.
      metadata: { tenant_id: tenantId, plan_id: planId || 'starter', supabase_user_id: user.id },
      subscription_data: {
        metadata: { tenant_id: tenantId },
      },
    });

    return res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('[Stripe Checkout] Errore:', err);
    res.status(500).json({ error: err.message || 'Errore Stripe' });
  }
});

// GET fee price ID in base al piano
function getFeePriceId(planId) {
  const feePrices = {
    starter: process.env.STRIPE_FEE_PRICE_STARTER || 'price_1TmdIgRZR2YaFu2sT5gkrMdx',
    pro: process.env.STRIPE_FEE_PRICE_PRO || 'price_1TmdK0RZR2YaFu2s8pXkLety',
    business: process.env.STRIPE_FEE_PRICE_BUSINESS || 'price_1TmdKuRZR2YaFu2sHeH8fShE',
  };
  return feePrices[planId] || feePrices.starter;
}

// POST /api/stripe/update-app-fee
router.post('/update-app-fee', async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Non autorizzato' });

  try {
    const { tenantId, action } = req.body; // action: 'increment' o 'decrement'
    if (!tenantId || !action) return res.status(400).json({ error: 'tenantId e action obbligatori' });

    const supabase = getSupabase();
    const stripe = getStripe();

    // Verifica membership
    const { data: membership } = await supabase
      .from('tenant_members')
      .select('tenant_id')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .single();

    if (!membership) return res.status(403).json({ error: 'Non autorizzato' });

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
    const { count: appCount, error: countError } = await supabase
      .from('apps')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

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
    res.status(500).json({ error: err.message || 'Errore aggiornamento fee' });
  }
});

// POST /api/sync-plan
router.post('/sync-plan', async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Non autorizzato' });

  try {
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'sessionId mancante' });

    const supabase = getSupabase();
    const stripe = getStripe();

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const tenantId = session.client_reference_id || session.metadata?.tenant_id;

    if (!tenantId) return res.status(400).json({ error: 'tenant_id mancante nella sessione' });

    const { data: membership } = await supabase
      .from('tenant_members')
      .select('tenant_id')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .single();

    if (!membership) return res.status(403).json({ error: 'Tenant non autorizzato' });

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

      const { error: insertError } = await supabase
        .from('processed_checkout_sessions')
        .insert({ session_id: sessionId, tenant_id: tenantId, plan: 'credit_topup', slots_added: 0 });

      if (insertError && insertError.code !== '23505') {
        console.error('[sync-plan] errore idempotenza (credit_topup):', insertError);
        return res.status(500).json({ error: 'Errore ricarica crediti' });
      }

      if (!insertError) {
        const { error: creditsError } = await supabase.rpc('grant_credits', {
          p_user_id: supabaseUserId,
          p_amount: creditsToAdd,
          p_type: 'purchase',
          p_description: 'Ricarica Extra crediti Vision',
          p_reference_id: sessionId,
          p_metadata: { plan_id: 'credit_topup', session_id: sessionId },
        });
        if (creditsError) {
          console.error('[sync-plan] errore grant_credits:', creditsError);
          return res.status(500).json({ error: 'Errore ricarica crediti' });
        }
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

    // Modello slot cumulativo: questa sessione può già essere stata
    // processata dal webhook Stripe (fonte autoritativa) o da un'altra
    // chiamata a questo stesso endpoint (es. refresh della pagina). La riga
    // in processed_checkout_sessions fa da guardia di idempotenza: solo chi
    // riesce a inserirla per primo somma gli slot, gli altri leggono soltanto
    // lo stato attuale del tenant.
    const { error: insertError } = await supabase
      .from('processed_checkout_sessions')
      .insert({ session_id: sessionId, tenant_id: tenantId, plan, slots_added: appLimit });

    if (insertError && insertError.code !== '23505') {
      console.error('[sync-plan] errore idempotenza:', insertError);
      return res.status(500).json({ error: 'Errore aggiornamento piano' });
    }

    if (!insertError) {
      if (creditsToAdd > 0) {
        const { error: creditsError } = await supabase.rpc('grant_credits', {
          p_user_id: supabaseUserId,
          p_amount: creditsToAdd,
          p_type: 'purchase',
          p_description: `Acquisto piano ${plan}`,
          p_reference_id: sessionId,
          p_metadata: { plan_id: plan, session_id: sessionId },
        });
        if (creditsError) console.error('[sync-plan] errore grant_credits:', creditsError);
      }

      const { error: rpcError } = await supabase.rpc('add_tenant_slots', {
        tenant_id: tenantId,
        slots_to_add: appLimit,
      });
      if (rpcError) {
        console.error('[sync-plan] errore add_tenant_slots:', rpcError);
        return res.status(500).json({ error: 'Errore aggiornamento piano' });
      }

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

        if (planError) {
          console.error('[sync-plan] errore update piano:', planError);
          return res.status(500).json({ error: 'Errore aggiornamento piano' });
        }
      } else {
        console.log(`[sync-plan] piano ${plan} non applicato: tenant ${tenantId} ha già ${currentTenant?.plan}`);
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
    res.status(500).json({ error: err.message || 'Errore sync piano' });
  }
});

module.exports = router;
