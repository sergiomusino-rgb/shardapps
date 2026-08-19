// ─── AI Usage tracking + budget enforcement (Pre-Beta Hardening, Blocco 1) ──
// Punto unico di persistenza/controllo costo AI, chiamato SOLO da
// src/lib/ai-router.ts (mai da una singola route — vedi commento in testa a
// quel file). Controparte TypeScript di backend/lib/ai-usage.js: stessa
// interfaccia, stessa logica, stesso motivo dei due ai-router.ts/js separati
// (frontend Next.js e backend Express sono due progetti npm distinti, non
// condividono node_modules né import).
//
// Ogni funzione qui accetta un SupabaseClient già costruito (mai lo crea da
// sé): stesso principio di testabilità già in uso in tutto il repo (vedi
// creator-generation-jobs.ts, public-api-auth.js — un fake supabase in
// memoria basta per testare la logica, senza un vero progetto Supabase).
//
// Filosofia fail-open sulla SOLA lettura di riepilogo (sumCostSince): un
// errore nel leggere lo storico di spesa (rete, tabella non ancora
// migrata) non deve mai bloccare una chiamata AI altrimenti legittima — lo
// stesso principio già seguito da checkRateLimit/reserveAppSlot altrove nel
// repo. È l'opposto della soglia superata (fail-closed): quando sappiamo con
// certezza che il budget è superato, la chiamata è SEMPRE bloccata, mai un
// semplice warning (vedi checkAiBudget).

import type { SupabaseClient } from '@supabase/supabase-js';

export const DEFAULT_DAILY_BUDGET_USD = Number(process.env.AI_DEFAULT_DAILY_BUDGET_USD || '5');
export const DEFAULT_MONTHLY_BUDGET_USD = Number(process.env.AI_DEFAULT_MONTHLY_BUDGET_USD || '50');

export interface AiUsageEntry {
  tenantId: string;
  appId?: string | null;
  userId?: string | null;
  task: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Costo reale riportato dal provider. null se non disponibile — MAI stimato. */
  costUsd: number | null;
}

export interface BudgetCheckResult {
  ok: boolean;
  scope?: 'daily' | 'monthly';
  spentUsd?: number;
  limitUsd?: number;
}

function startOfDayIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function startOfMonthIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

interface TenantBudget {
  dailyUsd: number;
  monthlyUsd: number;
}

// Righe con cost_usd NULL (provider senza usage.cost affidabile) contano 0 ai
// fini del budget: non possiamo bloccare su un costo che non conosciamo, ma
// la riga resta comunque scritta per il volume/audit — vedi recordAiUsage.
async function resolveTenantBudget(supabase: SupabaseClient, tenantId: string): Promise<TenantBudget> {
  const { data } = await supabase
    .from('tenants')
    .select('ai_daily_budget_usd, ai_monthly_budget_usd')
    .eq('id', tenantId)
    .maybeSingle();

  const row = data as { ai_daily_budget_usd?: number | null; ai_monthly_budget_usd?: number | null } | null;
  return {
    dailyUsd: typeof row?.ai_daily_budget_usd === 'number' ? row.ai_daily_budget_usd : DEFAULT_DAILY_BUDGET_USD,
    monthlyUsd: typeof row?.ai_monthly_budget_usd === 'number' ? row.ai_monthly_budget_usd : DEFAULT_MONTHLY_BUDGET_USD,
  };
}

async function sumCostSince(supabase: SupabaseClient, tenantId: string, sinceIso: string): Promise<number> {
  const { data, error } = await supabase
    .from('ai_usage')
    .select('cost_usd')
    .eq('tenant_id', tenantId)
    .gte('created_at', sinceIso);

  // Fail-open: vedi commento in testa al file. Un errore di lettura (rete,
  // tabella non ancora migrata su questo ambiente) non deve mai bloccare una
  // chiamata AI per un problema nostro, non del tenant.
  if (error || !Array.isArray(data)) return 0;
  return (data as Array<{ cost_usd: number | null }>).reduce((sum, row) => sum + (typeof row.cost_usd === 'number' ? row.cost_usd : 0), 0);
}

/**
 * Controlla se il tenant ha ancora budget disponibile PRIMA di chiamare il
 * provider AI. Un tenantId assente (chiamanti legacy che non lo passano
 * ancora nel context, vedi ai-router.ts) non ha alcun budget applicabile:
 * ritorna sempre ok:true, non essendoci alcun tenant a cui addebitare/da cui
 * negare il consumo.
 */
export async function checkAiBudget(supabase: SupabaseClient, tenantId: string | null | undefined): Promise<BudgetCheckResult> {
  if (!tenantId) return { ok: true };

  const budget = await resolveTenantBudget(supabase, tenantId);
  const [dailySpent, monthlySpent] = await Promise.all([
    sumCostSince(supabase, tenantId, startOfDayIso()),
    sumCostSince(supabase, tenantId, startOfMonthIso()),
  ]);

  if (dailySpent >= budget.dailyUsd) {
    return { ok: false, scope: 'daily', spentUsd: dailySpent, limitUsd: budget.dailyUsd };
  }
  if (monthlySpent >= budget.monthlyUsd) {
    return { ok: false, scope: 'monthly', spentUsd: monthlySpent, limitUsd: budget.monthlyUsd };
  }
  return { ok: true };
}

/**
 * Risolve il tenant_id di un'app, per i chiamanti di callAiRouter che oggi
 * passano solo `context.appId` (es. app/api/client/apps/[id]/schema/
 * route.ts) senza risolvere loro stessi il tenant. null se l'app non esiste
 * più o l'appId non è valorizzato — mai un'eccezione, il budget resta
 * semplicemente non applicabile per questa chiamata (stesso principio di
 * tenantId assente, vedi checkAiBudget).
 */
export async function resolveTenantIdForApp(supabase: SupabaseClient, appId: string | null | undefined): Promise<string | null> {
  if (!appId) return null;
  try {
    const { data } = await supabase.from('apps').select('tenant_id').eq('id', appId).maybeSingle();
    const row = data as { tenant_id?: string } | null;
    return row?.tenant_id || null;
  } catch {
    return null;
  }
}

/**
 * Persiste il consumo di UNA chiamata AI reale già eseguita. Non lancia mai:
 * un fallimento di scrittura della telemetria di costo non deve mai far
 * fallire una chiamata AI il cui risultato è già stato restituito al
 * chiamante (stesso principio di logAction in action-dispatcher.js).
 * tenantId assente -> nessuna riga scritta (nessun tenant a cui addebitarla).
 */
export async function recordAiUsage(supabase: SupabaseClient, entry: AiUsageEntry): Promise<void> {
  if (!entry.tenantId) return;
  try {
    const { error } = await supabase.from('ai_usage').insert({
      tenant_id: entry.tenantId,
      app_id: entry.appId || null,
      user_id: entry.userId || null,
      task: entry.task,
      provider: entry.provider,
      model: entry.model,
      input_tokens: entry.inputTokens,
      output_tokens: entry.outputTokens,
      total_tokens: entry.totalTokens,
      cost_usd: entry.costUsd,
    });
    if (error) throw error;
  } catch (err) {
    console.error('[ai-usage] insert fallito (telemetria persa, chiamata AI non impattata):', err);
  }
}
