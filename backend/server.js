const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');
const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const { callAiRouter, extractJsonFromAiContent, AiRouterError, AiRouterConfigError } = require('./lib/ai-router');

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
    
    // In production, controlla la whitelist
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log(`[CORS] Origin bloccato: ${origin}`);
      callback(new Error(`Origin ${origin} non autorizzato`));
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
  return new Date(val * 1000).toISOString();
}

function getFeePriceId(planId) {
  // Recurring monthly fee price IDs
  const feePrices = {
    starter: 'price_1TmdIgRZR2YaFu2sT5gkrMdx',
    pro: 'price_1TmdK0RZR2YaFu2s8pXkLety',
    business: 'price_1TmdKuRZR2YaFu2sHeH8fShE',
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

const PLAN_SLOTS = { starter: 1, pro: 5, business: 100, basic: 1, vip: 100 };

// Rango dei piani: gli eventi Stripe (checkout.session.completed,
// payment_intent.succeeded) non arrivano garantiti in ordine cronologico.
// Se un tenant compra business e poi arriva in ritardo l'evento del vecchio
// acquisto starter, un update incondizionato di tenants.plan lo farebbe
// retrocedere. Si applica solo un piano pari o superiore a quello già salvato.
const PLAN_RANK = { free: 0, starter: 1, basic: 1, pro: 2, business: 3, vip: 3 };
function planRank(plan) {
  return PLAN_RANK[plan] ?? 0;
}

// Somma slot e (opzionalmente) aggiorna il piano del tenant una sola volta per
// checkout session, indipendentemente da quale dei 3 punti di sync (webhook,
// pagina /success, banner dashboard) la processa per primo o se Stripe
// re-invia lo stesso evento webhook. Il modello degli slot è cumulativo
// (vedi supabase_migrations/20260722_update_tenants_slots_cumulative.sql),
// quindi senza questa guardia una stessa sessione sommerebbe gli slot più volte.
async function applyCheckoutSessionOnce(supabase, sessionId, tenantId, plan, slotsToAdd) {
  const { error: insertError } = await supabase
    .from('processed_checkout_sessions')
    .insert({ session_id: sessionId, tenant_id: tenantId, plan: plan || 'extra_slot', slots_added: slotsToAdd });

  if (insertError) {
    if (insertError.code === '23505') {
      console.log(`[Stripe Webhook] sessione ${sessionId} già processata, skip`);
      return false;
    }
    throw insertError;
  }

  const { error: rpcError } = await supabase.rpc('add_tenant_slots', {
    tenant_id: tenantId,
    slots_to_add: slotsToAdd,
  });
  if (rpcError) throw rpcError;

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
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  const supabase = getSupabase();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const tenantId = session.client_reference_id || session.metadata?.tenant_id;
        const customerEmail = session.customer_email || session.customer_details?.email;

        console.log(`[Stripe Webhook] checkout.session.completed - sessionId: ${session.id}, tenantId: ${tenantId}, email: ${customerEmail}`);

        if (!tenantId) {
          console.error('[Stripe Webhook] tenant_id mancante');
          break;
        }

        const planId = session.metadata?.plan_id || 'starter';
        const quantity = parseInt(session.metadata?.quantity || '1', 10);

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

        // Handle extra slot purchase - somma slot (cumulativo)
        if (planId === 'extra_slot') {
          const applied = await applyCheckoutSessionOnce(supabase, session.id, tenantId, null, quantity);
          if (applied) {
            console.log(`[Stripe Webhook] +${quantity} slot extra per tenant ${tenantId}`);
          }
        } else {
          // Regular plan - risolve il piano e somma gli slot (cumulativo),
          // il campo "plan" mostra sempre l'ultimo piano acquistato
          const plan = await resolvePlanFromSession(stripe, session);
          console.log(`[Stripe Webhook] piano risolto: ${plan}`);

          const slotsToAdd = PLAN_SLOTS[plan] || 1;
          const applied = await applyCheckoutSessionOnce(supabase, session.id, tenantId, plan, slotsToAdd);
          if (applied) {
            console.log(`[Stripe Webhook] tenant ${tenantId} aggiornato: plan=${plan}, +${slotsToAdd} slot`);
          }
        }

        const subscriptionId = session.subscription;
        if (!subscriptionId) {
          console.error('[Stripe Webhook] subscription id mancante');
          break;
        }

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);

        await upsertSubscription(supabase, tenantId, {
          stripe_customer_id: session.customer,
          stripe_subscription_id: subscriptionId,
          status: subscription.status,
          current_period_start: getPeriodISO(subscription, 'current_period_start'),
          current_period_end: getPeriodISO(subscription, 'current_period_end'),
        });

        console.log(`[Stripe Webhook] Subscription attivata per tenant ${tenantId}`);

        // Crea automaticamente la fee subscription per le app (skip for extra_slot)
        const feePriceId = getFeePriceId(planId);
        
        if (planId !== 'extra_slot' && feePriceId) {
          try {
            const feeSubscription = await stripe.subscriptions.create({
              customer: session.customer,
              items: [{ price: feePriceId, quantity: 0 }], // Inizia da 0, verrà incrementata con le app
              metadata: { tenant_id: tenantId, type: 'app_fee' },
              proration_behavior: 'always_invoice',
            });

            console.log(`[Stripe Webhook] Fee subscription creata: ${feeSubscription.id} per tenant ${tenantId}`);
          } catch (err) {
            console.error(`[Stripe Webhook] Errore creazione fee subscription:`, err);
          }
        }

        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;
        if (!subscriptionId) break;

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const tenantId = await getTenantIdBySubscriptionId(supabase, subscriptionId);

        if (!tenantId) {
          console.error(`invoice.payment_succeeded: tenant non trovato per ${subscriptionId}`);
          break;
        }

        await upsertSubscription(supabase, tenantId, {
          stripe_customer_id: invoice.customer,
          stripe_subscription_id: subscriptionId,
          status: subscription.status,
          current_period_start: getPeriodISO(subscription, 'current_period_start'),
          current_period_end: getPeriodISO(subscription, 'current_period_end'),
        });

        console.log(`Rinnovo pagato per tenant ${tenantId}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;
        if (!subscriptionId) break;

        const tenantId = await getTenantIdBySubscriptionId(supabase, subscriptionId);
        if (!tenantId) break;

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

        const tenantId = await getTenantIdBySubscriptionId(supabase, subscriptionId);
        if (!tenantId) break;

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

        const tenantId = await getTenantIdBySubscriptionId(supabase, subscriptionId);
        if (!tenantId) break;

        await upsertSubscription(supabase, tenantId, {
          stripe_customer_id: subscription.customer,
          stripe_subscription_id: subscriptionId,
          status: subscription.status,
          current_period_start: getPeriodISO(subscription, 'current_period_start'),
          current_period_end: getPeriodISO(subscription, 'current_period_end'),
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

        // Handle extra slot purchase - somma slot (cumulativo), idempotente su paymentIntent.id
        if (planId === 'extra_slot') {
          try {
            const applied = await applyCheckoutSessionOnce(supabase, paymentIntent.id, tenantId, null, quantity);
            if (applied) {
              console.log(`[Stripe Webhook] +${quantity} slot extra per tenant ${tenantId}`);
            }
          } catch (err) {
            console.error(`[Stripe Webhook] errore aggiornamento app_limit per extra_slot`, err);
          }
        } else {
          // Regular plan upgrade - create subscription
          if (feePriceId) {
            try {
              const feeSubscription = await stripe.subscriptions.create({
                customer: paymentIntent.customer,
                items: [{ price: feePriceId, quantity: 0 }],
                metadata: { tenant_id: tenantId, type: 'app_fee' },
                proration_behavior: 'always_invoice',
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
    res.status(500).json({ error: err.message || 'Errore webhook' });
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
app.post('/api/chat', requireAuth, async (req, res) => {
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
      return res.status(502).json({ error: err.message });
    }
    res.status(500).json({ error: err.message || 'Errore interno' });
  }
});

// --- VISION API ---
app.post('/api/vision/analyze', requireAuth, async (req, res) => {
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
    res.status(500).json({ error: err.message || 'Errore vision' });
  }
});

// --- GENERATE APP BLUEPRINT ---
app.post('/api/generate-app', requireAuth, async (req, res) => {
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
      return res.status(502).json({ error: err.message });
    }
    res.status(500).json({ error: err.message || 'Errore generazione blueprint' });
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
  res.status(500).json({ error: err.message || 'Errore interno del server' });
});

// Cron job per controllo scadenze app
const { startExpiryCheck } = require('./jobs/expiry-check');
startExpiryCheck();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ ZeusX backend attivo su http://0.0.0.0:${PORT}`);
});
