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

/**
 * Punto unico di ingresso per ogni chiamata a OpenRouter nel backend Express.
 * Sceglie il modello in base al tipo di task, gestisce la chiave API in modo
 * centralizzato e restituisce il costo reale della chiamata.
 *
 * @param {{task: string, messages: Array<{role: string, content: string}>, jsonMode?: boolean, maxTokens?: number, temperature?: number, modelOverride?: string, context?: {userId?: string, tenantId?: string}}} options
 */
async function callAiRouter(options) {
  const { task, messages, jsonMode, maxTokens, temperature, modelOverride, context } = options;

  const tier = TASK_TIER_MAP[task];
  if (!tier) {
    throw new AiRouterConfigError(`Task AI sconosciuto: "${task}"`);
  }

  const apiKey = getOpenRouterApiKey();
  const model = modelOverride || resolveModel(tier);
  const tierConfig = TIER_CONFIG[tier];

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
    });
  } catch (err) {
    throw new AiRouterError(`Errore di rete verso OpenRouter: ${err.message || 'sconosciuto'}`);
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error('[ai-router] OpenRouter error:', { task, tier, model, status: res.status, data });
    throw new AiRouterError(data?.error?.message || `Errore OpenRouter (${res.status})`, res.status, data);
  }

  const content = data.choices?.[0]?.message?.content || '';
  const rawUsage = data.usage || {};
  const usage = {
    promptTokens: rawUsage.prompt_tokens ?? 0,
    completionTokens: rawUsage.completion_tokens ?? 0,
    totalTokens: rawUsage.total_tokens ?? 0,
    costUsd: typeof rawUsage.cost === 'number' ? rawUsage.cost : null,
  };

  // Log strutturato: oggi è l'unico punto di osservabilità sui costi AI nel
  // backend (non esiste ancora una tabella di usage/costo persistita).
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
};
