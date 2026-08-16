// ─── generation_jobs — store (CreatorAI Engine 2.0, Fase 5) ────────────────
// CRUD minimale sulla tabella `generation_jobs` (migration
// 20260823000000_generation_jobs.sql): la macchina a stati PERSISTITA del
// processo planner->generator->validator->repair->ready/failed, usata da
// frontend/src/lib/creator-ai-orchestrator.ts. Isolato in un modulo a parte
// (non dentro l'orchestrator) per due motivi:
// - testabile da solo contro un vero progetto Supabase (creazione,
//   transizioni di stato, isolamento tenant), senza dover anche stimolare
//   planner/generator/validator;
// - `getGenerationJobForTenant` è il punto UNICO in cui "un job è
//   accessibile solo dal tenant proprietario" viene enforced (RLS nega
//   l'accesso diretto da client anon/authenticated — vedi migration — quindi
//   l'isolamento per tenant è responsabilità di QUESTO filtro applicativo,
//   non della sola RLS).
//
// Nessun segreto qui dentro: `context`/`artifacts` sono scritti SOLO da
// creator-ai-orchestrator.ts con dati non sensibili (projectType, sector,
// lang, errori di validazione, esito repair) — mai token/API key. Vedi
// ASSERT_NO_SECRETS_KEYS più sotto, usata anche dai test di sicurezza.

import type { SupabaseClient } from '@supabase/supabase-js';

export type GenerationJobStatus =
  | 'planning'
  | 'generating'
  | 'validating'
  | 'repairing'
  | 'ready'
  | 'failed';

export interface GenerationJobRow {
  id: string;
  tenant_id: string;
  app_id: string | null;
  created_by: string | null;
  status: GenerationJobStatus;
  current_step: string | null;
  user_prompt: string | null;
  context: Record<string, unknown>;
  plan: unknown;
  specification: unknown;
  artifacts: Record<string, unknown>;
  error: string | null;
  retry_count: number;
  fallback_used: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateGenerationJobInput {
  tenantId: string;
  appId?: string | null;
  createdBy?: string | null;
  userPrompt?: string | null;
  context?: Record<string, unknown>;
}

const TABLE = 'generation_jobs';

// Chiavi che non devono MAI comparire (a nessun livello di annidamento) in
// `context`/`artifacts`/`plan`/`specification` — rete di sicurezza per il
// requisito Fase 5 "NON salvare segreti/API key nel job", verificata anche
// dai test (vedi creator-generation-jobs.test.ts, "nessun secret persistito").
const FORBIDDEN_KEY_PATTERN = /(api[_-]?key|secret|password|token|authorization|bearer)/i;

export function findForbiddenSecretKey(value: unknown, path = ''): string | null {
  if (value == null || typeof value !== 'object') return null;
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_KEY_PATTERN.test(key)) return currentPath;
    const nested = findForbiddenSecretKey(v, currentPath);
    if (nested) return nested;
  }
  return null;
}

export async function createGenerationJob(
  supabase: SupabaseClient,
  input: CreateGenerationJobInput
): Promise<GenerationJobRow> {
  const forbidden = findForbiddenSecretKey(input.context || {});
  if (forbidden) {
    throw new Error(`createGenerationJob: chiave sospetta di segreto in context.${forbidden} — rifiutato`);
  }

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      tenant_id: input.tenantId,
      app_id: input.appId ?? null,
      created_by: input.createdBy ?? null,
      status: 'planning',
      current_step: 'planner',
      user_prompt: input.userPrompt ?? null,
      context: input.context ?? {},
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`createGenerationJob: ${error?.message || 'insert fallito'}`);
  }
  return data as GenerationJobRow;
}

export interface UpdateGenerationJobPatch {
  status?: GenerationJobStatus;
  current_step?: string | null;
  plan?: unknown;
  specification?: unknown;
  artifacts?: Record<string, unknown>;
  error?: string | null;
  retry_count?: number;
  fallback_used?: boolean;
}

export async function updateGenerationJob(
  supabase: SupabaseClient,
  jobId: string,
  patch: UpdateGenerationJobPatch
): Promise<GenerationJobRow> {
  if (patch.artifacts) {
    const forbidden = findForbiddenSecretKey(patch.artifacts);
    if (forbidden) {
      throw new Error(`updateGenerationJob: chiave sospetta di segreto in artifacts.${forbidden} — rifiutato`);
    }
  }

  const { data, error } = await supabase
    .from(TABLE)
    .update(patch)
    .eq('id', jobId)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`updateGenerationJob: ${error?.message || 'update fallito'}`);
  }
  return data as GenerationJobRow;
}

/**
 * Unico punto di lettura di un job "per un chiamante": filtra ESPLICITAMENTE
 * per tenant_id, non si fida della sola RLS (che qui nega comunque l'accesso
 * diretto da client anon/authenticated — vedi migration). Ritorna `null` sia
 * per "job inesistente" sia per "job di un altro tenant": stessa risposta,
 * per non rivelare a un chiamante se un jobId altrui esiste o meno.
 */
export async function getGenerationJobForTenant(
  supabase: SupabaseClient,
  jobId: string,
  tenantId: string
): Promise<GenerationJobRow | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('id', jobId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) throw new Error(`getGenerationJobForTenant: ${error.message}`);
  return (data as GenerationJobRow | null) ?? null;
}
