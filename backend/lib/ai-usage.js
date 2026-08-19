'use strict';

// ─── AI Usage tracking + budget enforcement (Pre-Beta Hardening, Blocco 1) ──
// Controparte CommonJS di frontend/src/lib/ai-usage.ts — stessa interfaccia,
// stessa logica, stesso motivo dei due ai-router.ts/js separati (frontend
// Next.js e backend Express sono due progetti npm distinti). Vedi il
// commento in testa a quel file per la filosofia fail-open/fail-closed.

const DEFAULT_DAILY_BUDGET_USD = Number(process.env.AI_DEFAULT_DAILY_BUDGET_USD || '5');
const DEFAULT_MONTHLY_BUDGET_USD = Number(process.env.AI_DEFAULT_MONTHLY_BUDGET_USD || '50');

function startOfDayIso(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function startOfMonthIso(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

async function resolveTenantBudget(supabase, tenantId) {
  const { data } = await supabase
    .from('tenants')
    .select('ai_daily_budget_usd, ai_monthly_budget_usd')
    .eq('id', tenantId)
    .maybeSingle();

  return {
    dailyUsd: typeof data?.ai_daily_budget_usd === 'number' ? data.ai_daily_budget_usd : DEFAULT_DAILY_BUDGET_USD,
    monthlyUsd: typeof data?.ai_monthly_budget_usd === 'number' ? data.ai_monthly_budget_usd : DEFAULT_MONTHLY_BUDGET_USD,
  };
}

async function sumCostSince(supabase, tenantId, sinceIso) {
  const { data, error } = await supabase
    .from('ai_usage')
    .select('cost_usd')
    .eq('tenant_id', tenantId)
    .gte('created_at', sinceIso);

  if (error || !Array.isArray(data)) return 0;
  return data.reduce((sum, row) => sum + (typeof row.cost_usd === 'number' ? row.cost_usd : 0), 0);
}

/**
 * Controlla se il tenant ha ancora budget disponibile PRIMA di chiamare il
 * provider AI. tenantId assente -> ok:true (nessun tenant a cui addebitare).
 */
async function checkAiBudget(supabase, tenantId) {
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
 * Risolve il tenant_id di un'app per i chiamanti di callAiRouter che passano
 * solo context.tenantId (già il caso più comune lato backend, vedi
 * server.js::/api/generate-app) — presente per simmetria con
 * frontend/src/lib/ai-usage.ts::resolveTenantIdForApp. null se l'app non
 * esiste, mai un'eccezione.
 */
async function resolveTenantIdForApp(supabase, appId) {
  if (!appId) return null;
  try {
    const { data } = await supabase.from('apps').select('tenant_id').eq('id', appId).maybeSingle();
    return data?.tenant_id || null;
  } catch {
    return null;
  }
}

/**
 * Persiste il consumo di UNA chiamata AI reale già eseguita. Non lancia mai.
 * tenantId assente -> nessuna riga scritta.
 */
async function recordAiUsage(supabase, entry) {
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
    console.error('[ai-usage] insert fallito (telemetria persa, chiamata AI non impattata):', err.message || err);
  }
}

module.exports = {
  DEFAULT_DAILY_BUDGET_USD,
  DEFAULT_MONTHLY_BUDGET_USD,
  checkAiBudget,
  recordAiUsage,
  resolveTenantIdForApp,
};
