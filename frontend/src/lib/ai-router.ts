// ─── AI Model Router (OpenRouter) ──────────────────────────────────────────────
// Punto centrale per le chiamate a OpenRouter nel backend ZeusX. Instrada ogni
// richiesta verso un modello "advanced" (generazione complessa: nuove app,
// schema, codice — es. l'app del Lotto) o "fast" (micro-fix, testo, UI) in
// base al tipo di task dichiarato dal chiamante, invece di lasciare che ogni
// route scelga/hardcodi un modello per conto proprio (comportamento oggi
// duplicato tra creator/generate, client/apps/[id]/schema, chat/route.ts...).
//
// Il costo di ogni chiamata non è stimato con una tabella prezzi locale (che
// invecchierebbe a ogni variazione di listino): OpenRouter lo restituisce già
// calcolato in `usage.cost` quando si passa `usage: { include: true }` — lo
// leggiamo direttamente dalla risposta.

export type AiTaskType =
  | 'app-generation'   // nuova app/sito completo da prompt (Creator AI)
  | 'code-generation'  // generazione di codice/logica complessa
  | 'schema-edit'      // aggiunta/modifica tabelle o campi su un'app esistente
  | 'text-edit'        // ritocchi di copy/testo
  | 'ui-tweak'         // piccoli aggiustamenti di stile/UI
  | 'micro-fix'        // fix puntuali, bug minori
  | 'chat';            // assistente conversazionale generico (/api/chat)

export type AiModelTier = 'advanced' | 'fast';

interface TierConfig {
  /** Env var che può sovrascrivere il modello di default di questo tier. */
  envVar: string;
  defaultModel: string;
  /** Tetto di token di output di default per questo tier (contenimento costi). */
  defaultMaxTokens: number;
}

// Unico punto in cui sono definiti i modelli usati: per cambiarli non serve
// toccare le singole route, basta l'env var o questo default.
const TIER_CONFIG: Record<AiModelTier, TierConfig> = {
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

// Mappa dichiarativa task -> tier: è l'unico punto da toccare per decidere
// quali task usano il modello avanzato vs quello economico/veloce.
const TASK_TIER_MAP: Record<AiTaskType, AiModelTier> = {
  'app-generation': 'advanced',
  'code-generation': 'advanced',
  'schema-edit': 'fast',
  'text-edit': 'fast',
  'ui-tweak': 'fast',
  'micro-fix': 'fast',
  'chat': 'fast',
};

// Soglia oltre la quale una singola chiamata viene segnalata come anomala nei
// log: il costo è noto solo a risposta ricevuta, quindi non può bloccare la
// richiesta in corso, ma aiuta a individuare prompt/task mal classificati.
const COST_WARN_USD = Number(process.env.AI_ROUTER_COST_WARN_USD || '0.5');

export class AiRouterConfigError extends Error {}

export class AiRouterError extends Error {
  status?: number;
  body?: unknown;
  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// Gestione centralizzata della chiave: fallisce subito con un errore chiaro
// invece di lasciare che ogni route mandi `Bearer ` (stringa vuota) a
// OpenRouter e debba poi decifrare un 401 generico.
function getOpenRouterApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new AiRouterConfigError(
      'OPENROUTER_API_KEY non configurata: impossibile effettuare chiamate AI.'
    );
  }
  return key;
}

function resolveModel(tier: AiModelTier): string {
  const cfg = TIER_CONFIG[tier];
  return process.env[cfg.envVar] || cfg.defaultModel;
}

export interface AiRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiRouterCallOptions {
  /** Tipo di task: determina quale tier/modello viene usato (vedi TASK_TIER_MAP). */
  task: AiTaskType;
  messages: AiRouterMessage[];
  /** Forza la risposta in JSON (JSON mode, supportato dai modelli via OpenRouter). */
  jsonMode?: boolean;
  /** Override del tetto di token di output rispetto al default del tier. */
  maxTokens?: number;
  temperature?: number;
  /** Escape hatch: bypassa il routing task->tier e forza un modello specifico. */
  modelOverride?: string;
  /** Contesto opzionale solo per i log (non viene inviato al provider). */
  context?: { userId?: string; tenantId?: string; appId?: string };
}

export interface AiRouterUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Costo reale in USD della chiamata, come riportato da OpenRouter (null se assente). */
  costUsd: number | null;
}

export interface AiRouterResult {
  content: string;
  task: AiTaskType;
  tier: AiModelTier;
  model: string;
  usage: AiRouterUsage;
}

/**
 * Punto unico di ingresso per ogni chiamata a OpenRouter nel backend ZeusX.
 * Sceglie il modello in base al tipo di task, gestisce la chiave API in modo
 * centralizzato e restituisce il costo reale della chiamata.
 */
export async function callAiRouter(options: AiRouterCallOptions): Promise<AiRouterResult> {
  const { task, messages, jsonMode, maxTokens, temperature, modelOverride, context } = options;

  const tier = TASK_TIER_MAP[task];
  if (!tier) {
    throw new AiRouterConfigError(`Task AI sconosciuto: "${task}"`);
  }

  const apiKey = getOpenRouterApiKey();
  const model = modelOverride || resolveModel(tier);
  const tierConfig = TIER_CONFIG[tier];

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: maxTokens ?? tierConfig.defaultMaxTokens,
    // Richiede a OpenRouter il costo reale della chiamata nella risposta,
    // invece di stimarlo con una tabella prezzi locale.
    usage: { include: true },
  };
  if (temperature !== undefined) body.temperature = temperature;
  if (jsonMode) body.response_format = { type: 'json_object' };

  let res: Response;
  try {
    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://zeusx.app',
        'X-Title': 'ZeusX AI Router',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new AiRouterError(
      `Errore di rete verso OpenRouter: ${err instanceof Error ? err.message : 'sconosciuto'}`
    );
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error('[ai-router] OpenRouter error:', { task, tier, model, status: res.status, data });
    throw new AiRouterError(data?.error?.message || `Errore OpenRouter (${res.status})`, res.status, data);
  }

  const content: string = data.choices?.[0]?.message?.content || '';
  const rawUsage = data.usage || {};
  const usage: AiRouterUsage = {
    promptTokens: rawUsage.prompt_tokens ?? 0,
    completionTokens: rawUsage.completion_tokens ?? 0,
    totalTokens: rawUsage.total_tokens ?? 0,
    costUsd: typeof rawUsage.cost === 'number' ? rawUsage.cost : null,
  };

  // Log strutturato: oggi è l'unico punto di osservabilità sui costi AI nel
  // backend (non esiste ancora una tabella di usage/costo persistita — il
  // valore di `usage.costUsd` restituito da questa funzione è già pronto
  // per essere salvato da un chiamante quando servirà).
  const costLabel = usage.costUsd !== null ? `$${usage.costUsd.toFixed(6)}` : 'n/a';
  const contextLabel = [
    context?.tenantId ? `tenant=${context.tenantId}` : null,
    context?.appId ? `app=${context.appId}` : null,
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
 * Centralizza una logica finora duplicata in più route.
 */
export function extractJsonFromAiContent(content: string): unknown {
  const cleaned = content.replace(/```json/gi, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new AiRouterError('Nessun JSON valido nella risposta del modello');
  }
  try {
    return JSON.parse(match[0]);
  } catch (err) {
    throw new AiRouterError(
      `Errore parsing JSON: ${err instanceof Error ? err.message : 'sconosciuto'}`
    );
  }
}
