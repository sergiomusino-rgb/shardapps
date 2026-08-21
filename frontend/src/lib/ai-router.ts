// ─── AI Model Router (OpenRouter) ──────────────────────────────────────────────
// Punto centrale per le chiamate a OpenRouter nel backend ShardApps. Instrada ogni
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
//
// ─── Pre-Beta Hardening, Blocco 1 (AI Cost Control) + Blocco 3 (AI reliability) ──
// Aggiunge, in questo UNICO punto centrale (mai duplicato per route, come
// richiesto dal task):
// - budget check PRIMA di ogni chiamata al provider (checkAiBudget,
//   src/lib/ai-usage.ts) quando il tenant è risolvibile da context.tenantId
//   o context.appId — un tenant oltre il tetto giornaliero/mensile riceve un
//   AiBudgetExceededError, il provider non viene MAI contattato;
// - persistenza del consumo reale (recordAiUsage) dopo ogni chiamata riuscita;
// - timeout esplicito configurabile (AI_ROUTER_TIMEOUT_MS) — nessuna fetch
//   può restare appesa indefinitamente;
// - un retry minimo (massimo 1) solo su errori transitori (429/5xx/timeout),
//   mai su errori di configurazione o 4xx permanenti;
// - un circuit breaker minimo in-memory: fallimenti CONSECUTIVI del
//   provider oltre soglia aprono il circuito per un breve raffreddamento,
//   così un provider realmente down non riceve un flusso infinito di
//   richieste — si richiude da solo alla prima chiamata riuscita.
//
// Un tenantId non risolvibile (chiamanti legacy che non lo passano ancora,
// vedi app/api/generate-video/route.ts) NON blocca la chiamata: nessun
// budget è applicabile senza un tenant a cui addebitarla — comportamento
// esistente invariato per quei chiamanti, vedi nota in ai-usage.ts.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { checkAiBudget, recordAiUsage, resolveTenantIdForApp } from './ai-usage.ts';

export type AiTaskType =
  | 'app-generation'   // nuova app/sito completo da prompt (Creator AI)
  | 'code-generation'  // generazione di codice/logica complessa
  | 'schema-edit'      // aggiunta/modifica tabelle o campi su un'app esistente
  | 'text-edit'        // ritocchi di copy/testo
  | 'ui-tweak'         // piccoli aggiustamenti di stile/UI
  | 'micro-fix'        // fix puntuali, bug minori
  | 'chat'             // assistente conversazionale generico (/api/chat)
  // CreatorAI Engine 2.0, Fase 5 (AI Agent Orchestrator, vedi
  // frontend/src/lib/creator-ai-orchestrator.ts): nessun nuovo provider/
  // modello, solo due nuove etichette di task instradate sul tier "fast"
  // già esistente (stesso tier di schema-edit/text-edit/ui-tweak/micro-fix)
  // — servono solo a distinguere questi due step nei log dei costi.
  | 'app-planning'     // Planner: piano breve/strutturato prima della generazione
  | 'app-repair';      // Repair Agent: corregge una specification che non valida

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
  'app-planning': 'fast',
  'app-repair': 'fast',
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

// AiBudgetExceededError estende AiRouterError (non una gerarchia separata):
// ogni chiamante esistente che già fa `if (err instanceof AiRouterError)`
// (creator/generate, creator/refactor, chat, client/apps/[id]/schema, ecc.)
// continua a funzionare invariato anche senza essere aggiornato, restituendo
// un 502 con un messaggio comunque chiaro e sicuro (mai dettagli del
// provider — status/body restano sempre undefined qui). I chiamanti
// principali (vedi creator/generate, creator/refactor, chat) intercettano
// questo tipo PRIMA di AiRouterError per rispondere con un 429 più corretto
// semanticamente ("limite raggiunto", non "il provider ha fallito").
export class AiBudgetExceededError extends AiRouterError {
  scope: 'daily' | 'monthly';
  constructor(scope: 'daily' | 'monthly') {
    super(
      scope === 'daily'
        ? 'Limite di utilizzo AI giornaliero raggiunto per questo account. Riprova domani o contatta il supporto.'
        : 'Limite di utilizzo AI mensile raggiunto per questo account. Contatta il supporto per aumentarlo.'
    );
    this.scope = scope;
  }
}

// Aperto quando il provider fallisce ripetutamente (vedi CIRCUIT_BREAKER_*
// sotto): il chiamante riceve subito questo errore, senza che la richiesta
// raggiunga OpenRouter — non è un errore di configurazione/budget, quindi
// resta un AiRouterError "puro" (i chiamanti esistenti lo trattano già
// correttamente come errore del provider, 502).
export class AiCircuitOpenError extends AiRouterError {
  constructor() {
    super('Il servizio AI è temporaneamente non disponibile (troppi errori consecutivi). Riprova tra poco.');
  }
}

export class AiTimeoutError extends AiRouterError {
  constructor(timeoutMs: number) {
    super(`Timeout della chiamata AI dopo ${timeoutMs}ms`);
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

// ─── Timeout + retry (Blocco 3) ─────────────────────────────────────────────
// Configurabile via env, mai hardcoded: un ambiente con un provider più
// lento del solito (o più veloce, per test) può regolarlo senza un deploy di
// codice.
const AI_ROUTER_TIMEOUT_MS = Number(process.env.AI_ROUTER_TIMEOUT_MS || '30000');
const AI_ROUTER_RETRY_BACKOFF_MS = Number(process.env.AI_ROUTER_RETRY_BACKOFF_MS || '500');
const MAX_RETRIES = 1; // "massimo 1 retry", esplicito nel task — mai un loop

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Errore transitorio = vale la pena riprovarlo UNA volta: timeout, errore di
// rete, 429 (rate limit del provider) o 5xx (problema lato provider). Un 4xx
// diverso da 429 (400 richiesta malformata, 401 chiave invalida, ecc.) è un
// errore permanente — riprovarlo produrrebbe sempre lo stesso esito, quindi
// NON viene mai ritentato (requisito esplicito del task).
function isTransientFailure(status: number | undefined, isTimeoutOrNetwork: boolean): boolean {
  if (isTimeoutOrNetwork) return true;
  if (status === 429) return true;
  if (status !== undefined && status >= 500) return true;
  return false;
}

// ─── Circuit breaker minimo (Blocco 1, punto E) ─────────────────────────────
// Stato in-memory per processo (coerente con l'architettura serverless/
// long-running già in uso, nessuna coda/Redis introdotta): conta i
// fallimenti CONSECUTIVI del provider (dopo l'eventuale retry già esaurito,
// mai due volte per la stessa chiamata logica) e apre il circuito solo dopo
// una soglia, per un breve raffreddamento — mai un blocco permanente, si
// richiude da solo alla prima chiamata riuscita successiva al cooldown.
// Deliberatamente NON conta i fallimenti di configurazione/budget (chiave
// mancante, tenant senza credito): quelli non indicano affatto che il
// provider sia down, aprire il circuito per quello bloccherebbe ingiustamente
// gli altri tenant con provider perfettamente disponibile.
const CIRCUIT_BREAKER_THRESHOLD = Number(process.env.AI_CIRCUIT_BREAKER_THRESHOLD || '5');
const CIRCUIT_BREAKER_COOLDOWN_MS = Number(process.env.AI_CIRCUIT_BREAKER_COOLDOWN_MS || '30000');
let circuitConsecutiveFailures = 0;
let circuitOpenUntil = 0;

function isCircuitOpen(): boolean {
  return Date.now() < circuitOpenUntil;
}

function recordCircuitSuccess(): void {
  circuitConsecutiveFailures = 0;
  circuitOpenUntil = 0;
}

function recordCircuitFailure(): void {
  circuitConsecutiveFailures += 1;
  if (circuitConsecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
  }
}

// Esportato SOLO per i test (reset dello stato tra un test e l'altro, il
// circuito è uno stato di modulo condiviso): mai chiamato da codice di
// produzione.
export function __resetAiRouterCircuitBreakerForTests(): void {
  circuitConsecutiveFailures = 0;
  circuitOpenUntil = 0;
}

interface OpenRouterCallResult {
  data: Record<string, unknown>;
  /** Status HTTP della risposta (sempre 2xx qui: callOpenRouterOnce lancia
   * su !res.ok) — usato solo per il log diagnostico "content vuoto/zero
   * token" sotto (P0 Generation Reliability), mai per decidere retry. */
  status: number;
}

// Un singolo tentativo di chiamata a OpenRouter, con timeout esplicito.
// Lancia AiTimeoutError (isTimeoutOrNetwork) su timeout/errore di rete, o
// AiRouterError con `.status` valorizzato su una risposta HTTP non-ok — mai
// un altro tipo, così fetchWithRetry può decidere se ritentare guardando
// solo questi due casi.
async function callOpenRouterOnce(apiKey: string, body: Record<string, unknown>): Promise<OpenRouterCallResult> {
  let res: Response;
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
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new AiTimeoutError(AI_ROUTER_TIMEOUT_MS);
    }
    throw new AiRouterError(`Errore di rete verso OpenRouter: ${err instanceof Error ? err.message : 'sconosciuto'}`);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AiRouterError(data?.error?.message || `Errore OpenRouter (${res.status})`, res.status, data);
  }
  return { data, status: res.status };
}

// Orchestrazione retry: al massimo MAX_RETRIES tentativi extra, solo se
// l'errore del tentativo precedente è transitorio (vedi isTransientFailure).
// Un errore permanente (400/401/403, JSON parse, ecc.) esce subito al primo
// fallimento — "NON retryare errori di configurazione/API key/400
// permanenti", requisito esplicito del task.
async function fetchWithRetry(apiKey: string, body: Record<string, unknown>): Promise<OpenRouterCallResult> {
  let lastErr: unknown;
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
  // Irraggiungibile (il loop lancia o ritorna sempre), solo per soddisfare TypeScript.
  throw lastErr instanceof Error ? lastErr : new AiRouterError('Errore sconosciuto');
}

// Client Supabase service-role, creato pigramente e SOLO quando serve
// davvero risolvere/applicare un budget (mai per chiamate senza alcun
// tenant risolvibile) — non deve introdurre un costo o un punto di
// fallimento per i chiamanti che oggi non hanno alcun concetto di tenant.
let cachedSupabaseAdmin: SupabaseClient | null = null;
function getDefaultSupabaseAdmin(): SupabaseClient | null {
  if (cachedSupabaseAdmin) return cachedSupabaseAdmin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  cachedSupabaseAdmin = createClient(url, serviceKey);
  return cachedSupabaseAdmin;
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
  /**
   * SOLO per i test: inietta un client Supabase al posto di quello reale
   * (service role, costruito internamente da getDefaultSupabaseAdmin). I
   * chiamanti reali non lo passano MAI — omesso, callAiRouter usa il client
   * reale se e solo se un tenant è risolvibile dal context.
   */
  supabaseClient?: SupabaseClient;
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
 * Punto unico di ingresso per ogni chiamata a OpenRouter nel backend ShardApps.
 * Sceglie il modello in base al tipo di task, gestisce la chiave API in modo
 * centralizzato e restituisce il costo reale della chiamata.
 */
export async function callAiRouter(options: AiRouterCallOptions): Promise<AiRouterResult> {
  const { task, messages, jsonMode, maxTokens, temperature, modelOverride, context, supabaseClient } = options;

  const tier = TASK_TIER_MAP[task];
  if (!tier) {
    throw new AiRouterConfigError(`Task AI sconosciuto: "${task}"`);
  }

  const apiKey = getOpenRouterApiKey();
  const model = modelOverride || resolveModel(tier);
  const tierConfig = TIER_CONFIG[tier];

  // ─── Budget check (Blocco 1) ───────────────────────────────────────────
  // Fail-open SOLO sugli imprevisti infrastrutturali di QUESTO blocco (env
  // mancanti, eccezione nel risolvere il client): un problema nostro non
  // deve mai bloccare una chiamata AI altrimenti legittima. Quando invece
  // checkAiBudget determina con certezza che il tetto è superato, il blocco
  // è SEMPRE applicato (vedi throw sotto, mai un semplice warning).
  let resolvedTenantId: string | null = context?.tenantId || null;
  const supabase = supabaseClient || getDefaultSupabaseAdmin();
  if (supabase) {
    try {
      if (!resolvedTenantId && context?.appId) {
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

  // ─── Circuit breaker (Blocco 1, punto E) ───────────────────────────────
  if (isCircuitOpen()) {
    throw new AiCircuitOpenError();
  }

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

  let data: Record<string, unknown>;
  let httpStatus: number;
  try {
    ({ data, status: httpStatus } = await fetchWithRetry(apiKey, body));
    recordCircuitSuccess();
  } catch (err) {
    // Solo i fallimenti "del provider" (timeout/rete/5xx/429, già filtrati
    // da isTransientFailure per il retry) contano per il circuit breaker —
    // vedi commento sulla soglia sopra. Un 4xx permanente non lo apre.
    const status = err instanceof AiRouterError ? err.status : undefined;
    const isTimeout = err instanceof AiTimeoutError;
    if (isTransientFailure(status, isTimeout || !(err instanceof AiRouterError))) {
      recordCircuitFailure();
    }
    if (err instanceof AiRouterError) {
      console.error('[ai-router] OpenRouter error:', { task, tier, model, status: err.status });
      throw err;
    }
    throw new AiRouterError(`Errore imprevisto verso OpenRouter: ${err instanceof Error ? err.message : 'sconosciuto'}`);
  }

  const choices = data.choices as Array<{ message?: { content?: string }; finish_reason?: unknown }> | undefined;
  const content: string = choices?.[0]?.message?.content || '';
  const rawUsage = (data.usage as Record<string, unknown>) || {};
  const usage: AiRouterUsage = {
    promptTokens: (rawUsage.prompt_tokens as number) ?? 0,
    completionTokens: (rawUsage.completion_tokens as number) ?? 0,
    totalTokens: (rawUsage.total_tokens as number) ?? 0,
    costUsd: typeof rawUsage.cost === 'number' ? rawUsage.cost : null,
  };

  // P0 Generation Reliability (osservabilità, root-cause dimostrata live):
  // il provider può rispondere 2xx con content vuoto/zero token, senza
  // alcun errore HTTP — extractJsonFromAiContent lancia solo "Nessun JSON
  // valido nella risposta del modello", senza contesto su COSA sia
  // realmente arrivato. Log mirato SOLO qui, mai messages/prompt (possono
  // contenere dati cliente) né apiKey/Authorization.
  if (!content || usage.totalTokens === 0) {
    console.warn('[ai-router] risposta con content vuoto o zero token', {
      task,
      tier,
      model,
      httpStatus,
      finishReason: choices?.[0]?.finish_reason ?? null,
      hasContent: Boolean(content),
      hasChoices: Array.isArray(data.choices) && data.choices.length > 0,
      usagePresent: Boolean(data.usage),
      rawUsage,
      providerError: (data as { error?: unknown }).error ?? null,
    });
  }

  // Log strutturato (invariato) + persistenza reale del consumo (Blocco 1):
  // solo se un tenant è stato risolto sopra, stesso principio del budget
  // check — mai una riga orfana senza tenant a cui addebitarla.
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

  if (supabase && resolvedTenantId) {
    await recordAiUsage(supabase, {
      tenantId: resolvedTenantId,
      appId: context?.appId || null,
      userId: context?.userId || null,
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
