'use strict';

// ─── AI Model Router (OpenRouter) — backend Express ────────────────────────────
// Controparte CommonJS di frontend/src/lib/ai-router.ts. Il backend Express
// (deploy Render a sé stante, rootDir: backend — vedi render.yaml) è un
// progetto npm separato dal frontend Next.js: non condivide node_modules né
// alias di path, quindi non può importare direttamente il modulo TypeScript
// del frontend. Stessa interfaccia, stessa logica di routing task->tier e
// stesso costo reale via `usage.include` letto dalla risposta di OpenRouter.
//
// Istrada ogni richiesta verso un modello "advanced" (generazione complessa:
// nuove app, schema, codice) o "fast" (chat, micro-fix, testo, UI) in base al
// tipo di task dichiarato dal chiamante.
//
// ─── Pre-Beta Hardening, Blocco 1 (AI Cost Control) + Blocco 3 (AI reliability) ──
// Stesso identico comportamento aggiunto della controparte frontend (vedi il
// commento esteso in src/lib/ai-router.ts): budget check centralizzato,
// timeout esplicito, retry limitato su errori transitori, circuit breaker
// minimo. Un tenantId non risolvibile non blocca la chiamata (nessun budget
// applicabile).

const { createClient } = require('@supabase/supabase-js');
const { checkAiBudget, recordAiUsage, resolveTenantIdForApp } = require('./ai-usage');

const TIER_CONFIG = {
  advanced: {
    envVar: 'OPENROUTER_MODEL_ADVANCED',
    defaultModel: 'anthropic/claude-sonnet-5',
    defaultMaxTokens: 8000,
  },
  fast: {
    envVar: 'OPENROUTER_MODEL_FAST',
    defaultModel: 'anthropic/claude-haiku-4.5',
    defaultMaxTokens: 2000,
  },
};

// Mappa dichiarativa task -> tier: unico punto da toccare per decidere quali
// task usano il modello avanzato vs quello economico/veloce.
const TASK_TIER_MAP = {
  'app-generation': 'advanced',
  'code-generation': 'advanced',
  'schema-edit': 'fast',
  'text-edit': 'fast',
  'ui-tweak': 'fast',
  'micro-fix': 'fast',
  'chat': 'fast',
};

// Soglia oltre la quale una singola chiamata viene segnalata come anomala nei
// log (il costo è noto solo a risposta ricevuta, non può bloccare la richiesta).
const COST_WARN_USD = Number(process.env.AI_ROUTER_COST_WARN_USD || '0.5');

class AiRouterConfigError extends Error {}

class AiRouterError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// Vedi src/lib/ai-router.ts per il perché AiBudgetExceededError estende
// AiRouterError (compatibilità con ogni `instanceof AiRouterError` già
// esistente nei chiamanti, senza doverli aggiornare tutti).
class AiBudgetExceededError extends AiRouterError {
  constructor(scope) {
    super(
      scope === 'daily'
        ? 'Limite di utilizzo AI giornaliero raggiunto per questo account. Riprova domani o contatta il supporto.'
        : 'Limite di utilizzo AI mensile raggiunto per questo account. Contatta il supporto per aumentarlo.'
    );
    this.scope = scope;
  }
}

class AiCircuitOpenError extends AiRouterError {
  constructor() {
    super('Il servizio AI è temporaneamente non disponibile (troppi errori consecutivi). Riprova tra poco.');
  }
}

class AiTimeoutError extends AiRouterError {
  constructor(timeoutMs) {
    super(`Timeout della chiamata AI dopo ${timeoutMs}ms`);
  }
}

// Gestione centralizzata della chiave: fallisce subito con un errore chiaro
// invece di mandare `Bearer ` (stringa vuota) a OpenRouter.
function getOpenRouterApiKey() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new AiRouterConfigError(
      'OPENROUTER_API_KEY non configurata: impossibile effettuare chiamate AI.'
    );
  }
  return key;
}

function resolveModel(tier) {
  const cfg = TIER_CONFIG[tier];
  return process.env[cfg.envVar] || cfg.defaultModel;
}

// ─── Timeout + retry (Blocco 3) ─────────────────────────────────────────────
const AI_ROUTER_TIMEOUT_MS = Number(process.env.AI_ROUTER_TIMEOUT_MS || '30000');
const AI_ROUTER_RETRY_BACKOFF_MS = Number(process.env.AI_ROUTER_RETRY_BACKOFF_MS || '500');
const MAX_RETRIES = 1;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientFailure(status, isTimeoutOrNetwork) {
  if (isTimeoutOrNetwork) return true;
  if (status === 429) return true;
  if (status !== undefined && status >= 500) return true;
  return false;
}

// ─── Circuit breaker minimo (Blocco 1, punto E) ─────────────────────────────
const CIRCUIT_BREAKER_THRESHOLD = Number(process.env.AI_CIRCUIT_BREAKER_THRESHOLD || '5');
const CIRCUIT_BREAKER_COOLDOWN_MS = Number(process.env.AI_CIRCUIT_BREAKER_COOLDOWN_MS || '30000');
let circuitConsecutiveFailures = 0;
let circuitOpenUntil = 0;

function isCircuitOpen() {
  return Date.now() < circuitOpenUntil;
}
function recordCircuitSuccess() {
  circuitConsecutiveFailures = 0;
  circuitOpenUntil = 0;
}
function recordCircuitFailure() {
  circuitConsecutiveFailures += 1;
  if (circuitConsecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
  }
}
// Solo per i test.
function __resetAiRouterCircuitBreakerForTests() {
  circuitConsecutiveFailures = 0;
  circuitOpenUntil = 0;
}

async function callOpenRouterOnce(apiKey, body) {
  let res;
  try {
    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://zeusx.app',
        'X-Title': 'ShardApps AI Router',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AI_ROUTER_TIMEOUT_MS),
    });
  } catch (err) {
    if (err && err.name === 'TimeoutError') {
      throw new AiTimeoutError(AI_ROUTER_TIMEOUT_MS);
    }
    throw new AiRouterError(`Errore di rete verso OpenRouter: ${err.message || 'sconosciuto'}`);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AiRouterError(data?.error?.message || `Errore OpenRouter (${res.status})`, res.status, data);
  }
  return { data };
}

async function fetchWithRetry(apiKey, body) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await callOpenRouterOnce(apiKey, body);
    } catch (err) {
      lastErr = err;
      const isTimeout = err instanceof AiTimeoutError;
      const status = err instanceof AiRouterError ? err.status : undefined;
      const transient = isTransientFailure(status, isTimeout || !(err instanceof AiRouterError));
      if (!transient || attempt === MAX_RETRIES) {
        throw err;
      }
      console.warn(`[ai-router] tentativo ${attempt + 1} fallito (${isTimeout ? 'timeout' : `status ${status}`}), retry breve...`);
      await sleep(AI_ROUTER_RETRY_BACKOFF_MS);
    }
  }
  throw lastErr;
}

let cachedSupabaseAdmin = null;
function getDefaultSupabaseAdmin() {
  if (cachedSupabaseAdmin) return cachedSupabaseAdmin;
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  cachedSupabaseAdmin = createClient(url, serviceKey);
  return cachedSupabaseAdmin;
}

/**
 * Punto unico di ingresso per ogni chiamata a OpenRouter nel backend Express.
 * Sceglie il modello in base al tipo di task, gestisce la chiave API in modo
 * centralizzato e restituisce il costo reale della chiamata.
 *
 * @param {{task: string, messages: Array<{role: string, content: string}>, jsonMode?: boolean, maxTokens?: number, temperature?: number, modelOverride?: string, context?: {userId?: string, tenantId?: string, appId?: string}, supabaseClient?: object}} options
 */
async function callAiRouter(options) {
  const { task, messages, jsonMode, maxTokens, temperature, modelOverride, context, supabaseClient } = options;

  const tier = TASK_TIER_MAP[task];
  if (!tier) {
    throw new AiRouterConfigError(`Task AI sconosciuto: "${task}"`);
  }

  const apiKey = getOpenRouterApiKey();
  const model = modelOverride || resolveModel(tier);
  const tierConfig = TIER_CONFIG[tier];

  // ─── Budget check (Blocco 1) ────────────────────────────────────────────
  let resolvedTenantId = (context && context.tenantId) || null;
  const supabase = supabaseClient || getDefaultSupabaseAdmin();
  if (supabase) {
    try {
      if (!resolvedTenantId && context && context.appId) {
        resolvedTenantId = await resolveTenantIdForApp(supabase, context.appId);
      }
      if (resolvedTenantId) {
        const budgetCheck = await checkAiBudget(supabase, resolvedTenantId);
        if (!budgetCheck.ok && budgetCheck.scope) {
          console.warn(`[ai-router] budget AI superato: tenant=${resolvedTenantId} scope=${budgetCheck.scope} spent=$${budgetCheck.spentUsd?.toFixed(4)} limit=$${budgetCheck.limitUsd}`);
          throw new AiBudgetExceededError(budgetCheck.scope);
        }
      }
    } catch (err) {
      if (err instanceof AiBudgetExceededError) throw err;
      console.error('[ai-router] budget check fallito per un errore infrastrutturale, chiamata consentita:', err);
    }
  }

  // ─── Circuit breaker ─────────────────────────────────────────────────────
  if (isCircuitOpen()) {
    throw new AiCircuitOpenError();
  }

  const body = {
    model,
    messages,
    max_tokens: maxTokens ?? tierConfig.defaultMaxTokens,
    // Richiede a OpenRouter il costo reale della chiamata nella risposta,
    // invece di stimarlo con una tabella prezzi locale.
    usage: { include: true },
  };
  if (temperature !== undefined) body.temperature = temperature;
  if (jsonMode) body.response_format = { type: 'json_object' };

  let data;
  try {
    ({ data } = await fetchWithRetry(apiKey, body));
    recordCircuitSuccess();
  } catch (err) {
    const status = err instanceof AiRouterError ? err.status : undefined;
    const isTimeout = err instanceof AiTimeoutError;
    if (isTransientFailure(status, isTimeout || !(err instanceof AiRouterError))) {
      recordCircuitFailure();
    }
    if (err instanceof AiRouterError) {
      console.error('[ai-router] OpenRouter error:', { task, tier, model, status: err.status });
      throw err;
    }
    throw new AiRouterError(`Errore imprevisto verso OpenRouter: ${err.message || 'sconosciuto'}`);
  }

  const content = data.choices?.[0]?.message?.content || '';
  const rawUsage = data.usage || {};
  const usage = {
    promptTokens: rawUsage.prompt_tokens ?? 0,
    completionTokens: rawUsage.completion_tokens ?? 0,
    totalTokens: rawUsage.total_tokens ?? 0,
    costUsd: typeof rawUsage.cost === 'number' ? rawUsage.cost : null,
  };

  // Log strutturato + persistenza reale del consumo (Blocco 1).
  const costLabel = usage.costUsd !== null ? `$${usage.costUsd.toFixed(6)}` : 'n/a';
  const contextLabel = [
    context?.tenantId ? `tenant=${context.tenantId}` : null,
    context?.userId ? `user=${context.userId}` : null,
  ].filter(Boolean).join(' ');
  const logLine = `[ai-router] task=${task} tier=${tier} model=${model} tokens=${usage.totalTokens} cost=${costLabel}${contextLabel ? ` ${contextLabel}` : ''}`;

  if (usage.costUsd !== null && usage.costUsd > COST_WARN_USD) {
    console.warn(`${logLine} ⚠️ supera la soglia di $${COST_WARN_USD}`);
  } else {
    console.log(logLine);
  }

  if (supabase && resolvedTenantId) {
    await recordAiUsage(supabase, {
      tenantId: resolvedTenantId,
      appId: (context && context.appId) || null,
      userId: (context && context.userId) || null,
      task,
      provider: 'openrouter',
      model,
      inputTokens: usage.promptTokens,
      outputTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      costUsd: usage.costUsd,
    });
  }

  return { content, task, tier, model, usage };
}

/**
 * Estrae un oggetto JSON dalla risposta testuale di un modello, tollerando
 * fence markdown (```json ... ```) e testo residuo prima/dopo l'oggetto.
 */
function extractJsonFromAiContent(content) {
  const cleaned = content.replace(/```json/gi, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new AiRouterError('Nessun JSON valido nella risposta del modello');
  }
  try {
    return JSON.parse(match[0]);
  } catch (err) {
    throw new AiRouterError(`Errore parsing JSON: ${err.message || 'sconosciuto'}`);
  }
}

module.exports = {
  callAiRouter,
  getOpenRouterApiKey,
  extractJsonFromAiContent,
  AiRouterError,
  AiRouterConfigError,
  AiBudgetExceededError,
  AiCircuitOpenError,
  AiTimeoutError,
  __resetAiRouterCircuitBreakerForTests,
};
