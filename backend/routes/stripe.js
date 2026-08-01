const express = require('express');
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { checkoutLimiter } = require('../middleware/rate-limit');

const router = express.Router();
const STRIPE_API_VERSION = '2025-03-31.basil';

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
    //
    // Un'app entra nella quantity di questa fee solo se TUTTE le condizioni
    // sono vere:
    // 1. status != 'active' — le app con status:'active' hanno un cliente
    //    finale che paga tramite Stripe (vedi verify-checkout-session/route.ts,
    //    che imposta status:'active' + stripe_subscription_id al checkout
    //    del cliente): ZeusX incassa già la sua quota di 25€ trattenendola
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
    const { count: appCount, error: countError } = await supabase
      .from('apps')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .neq('status', 'active')
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
      .maybeSingle();

    let authorized = !!membership;
    if (!authorized) {
      // Stesso ordine di risoluzione di create-checkout-session (frontend):
      // un tenant trovato per owner_id non ha sempre una riga tenant_members
      // corrispondente — viene creata solo quando il tenant stesso viene
      // creato al momento del checkout, non quando esisteva già con
      // owner_id impostato in altro modo. Senza questo fallback, /sync-plan
      // rifiuta con 403 un pagamento legittimo: il piano viene comunque
      // aggiornato dal webhook (che risolve il tenant solo dal metadata),
      // ma l'utente non lo vede mai confermato/sincronizzato in app.
      const { data: tenantByOwner } = await supabase
        .from('tenants')
        .select('id')
        .eq('id', tenantId)
        .eq('owner_id', user.id)
        .maybeSingle();
      authorized = !!tenantByOwner;
    }

    if (!authorized) return res.status(403).json({ error: 'Tenant non autorizzato' });

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

      const { error: insertError } = await supabase
        .from('processed_checkout_sessions')
        .insert({ session_id: sessionId, tenant_id: tenantId, plan: 'credit_topup', slots_added: slotsToAdd });

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

        const { error: slotsError } = await supabase.rpc('add_tenant_slots', {
          tenant_id: tenantId,
          slots_to_add: slotsToAdd,
        });
        if (slotsError) {
          console.error('[sync-plan] errore add_tenant_slots (credit_topup):', slotsError);
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
