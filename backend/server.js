const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { aiLimiter } = require('./middleware/rate-limit');
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');
const { callAiRouter, extractJsonFromAiContent, AiRouterError, AiRouterConfigError, AiBudgetExceededError } = require('./lib/ai-router');
const { verifyWebhookSignature } = require('./lib/stripe-webhook-logic');
// Orchestrazione eventi webhook (switch + helper con I/O reale) estratta in
// lib/stripe-webhook-handler.js per essere chiamabile con supabase/stripe
// iniettati, senza passare da una richiesta HTTP reale — così è testabile
// end-to-end (vedi lib/stripe-webhook-handler.test.js). server.js resta
// l'unico responsabile della route Express: verifica la firma, crea i
// client reali, chiama l'handler.
const { handleStripeWebhookEvent } = require('./lib/stripe-webhook-handler');
const { captureError } = require('./lib/error-tracking');

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

app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) {
    console.error('[Stripe Webhook] STRIPE_SECRET_KEY non configurata');
    return res.status(503).json({ error: 'Stripe non configurato' });
  }

  const payload = req.body;
  const signature = req.headers['stripe-signature'] || '';

  // Verifica firma isolata in verifyWebhookSignature (lib/stripe-webhook-logic.js,
  // testata con node:test): 400 immediato, nessuna query/logica downstream
  // eseguita se la firma non è valida — comportamento invariato, solo reso
  // testabile in isolamento.
  const verification = verifyWebhookSignature(stripe, payload, signature, stripeWebhookSecret);
  if (!verification.ok) {
    console.error(`Webhook signature verification failed: ${verification.error}`);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }
  const event = verification.event;

  const supabase = getSupabase();

  try {
    // Tutta l'orchestrazione (switch sugli eventi + helper con I/O reale)
    // vive in lib/stripe-webhook-handler.js — comportamento invariato,
    // solo relocata per essere testabile end-to-end senza Express/HTTP reali.
    await handleStripeWebhookEvent(supabase, stripe, event);
    return res.json({ received: true });
  } catch (err) {
    console.error('Errore webhook Stripe:', err);
    res.status(500).json({ error: 'Errore webhook' });
  }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Le route AI sotto (chat, generate-app) chiamano OpenRouter via
// ./lib/ai-router.js (budget/retry/timeout/circuit breaker centralizzati) con
// le chiavi del proprietario del sito: senza autenticazione chiunque
// conoscesse l'URL del backend potrebbe consumare budget illimitato. Accetta
// sia un JWT Supabase reale (chiamata diretta dal browser) sia il
// BACKEND_SERVICE_TOKEN condiviso + X-User-ID (stesso schema di
// routes/stripe.js::getUser, per le chiamate server-to-server dal frontend
// Next.js che già autentica l'utente a monte).
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
    if (err instanceof AiBudgetExceededError) {
      return res.status(429).json({ error: err.message });
    }
    if (err instanceof AiRouterError) {
      return res.status(502).json({ error: 'Errore interno' });
    }
    res.status(500).json({ error: 'Errore interno' });
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
    if (err instanceof AiBudgetExceededError) {
      return res.status(429).json({ error: err.message });
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

// --- DATA EXPORT + PUBLIC API (gestione API key, lato proprietario) ---
app.use('/api', require('./routes/api-keys'));

// --- PUBLIC API v1 (accesso esterno ai dati di un'app, via API key) ---
app.use('/api/v1/apps', require('./routes/public-api'));

// --- ERROR HANDLER ---
// Pre-Beta Hardening, Blocco 7: unico punto che copre QUALUNQUE 500 non
// gestito da una route (le route già critiche hanno il proprio captureError
// puntuale — questo è la rete di sicurezza per tutto il resto).
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  captureError('server.unhandled', err, { path: req?.path, method: req?.method });
  res.status(500).json({ error: 'Errore interno del server' });
});

// Cron job per controllo scadenze app
const { startExpiryCheck } = require('./jobs/expiry-check');
startExpiryCheck();

// CreatorAI Engine 2.0, Fase 4: sorgente dell'evento 'schedule.tick' per il
// Logic/Workflow Engine — stesso pattern di startExpiryCheck() sopra.
const { startWorkflowTick } = require('./jobs/workflow-schedule');
startWorkflowTick();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ ShardApps backend attivo su http://0.0.0.0:${PORT}`);
});
