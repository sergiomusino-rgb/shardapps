// ─── Test: AI Usage tracking + budget enforcement (Pre-Beta Hardening) ─────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeSupabase } = require('./test-helpers/fake-supabase');
const { checkAiBudget, recordAiUsage, resolveTenantIdForApp, DEFAULT_DAILY_BUDGET_USD, DEFAULT_MONTHLY_BUDGET_USD } = require('./ai-usage');

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

function isoHoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function isoEarlierThisMonthNotToday() {
  const now = new Date();
  const startOfMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(Math.floor((startOfMonth + startOfToday) / 2)).toISOString();
}

test('recordAiUsage: inserisce una riga con tutti i campi attesi', async () => {
  const supabase = makeFakeSupabase();
  await recordAiUsage(supabase, {
    tenantId: TENANT_A, appId: 'app-1', userId: 'user-1', task: 'app-generation',
    provider: 'openrouter', model: 'anthropic/claude-sonnet-5',
    inputTokens: 100, outputTokens: 200, totalTokens: 300, costUsd: 0.05,
  });
  const { data } = await supabase.from('ai_usage').select().eq('tenant_id', TENANT_A);
  assert.equal(data.length, 1);
  assert.equal(data[0].app_id, 'app-1');
  assert.equal(data[0].cost_usd, 0.05);
  assert.equal(data[0].total_tokens, 300);
});

test('recordAiUsage: tenantId assente -> nessuna riga scritta', async () => {
  const supabase = makeFakeSupabase();
  await recordAiUsage(supabase, {
    tenantId: '', task: 'chat', provider: 'openrouter', model: 'x',
    inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0.01,
  });
  const { data } = await supabase.from('ai_usage').select();
  assert.equal(data.length, 0);
});

test('checkAiBudget: tenantId assente -> sempre ok', async () => {
  const supabase = makeFakeSupabase();
  const result = await checkAiBudget(supabase, undefined);
  assert.equal(result.ok, true);
});

test('checkAiBudget: nessun consumo storico -> ok', async () => {
  const supabase = makeFakeSupabase();
  const result = await checkAiBudget(supabase, TENANT_A);
  assert.equal(result.ok, true);
});

test('checkAiBudget: budget giornaliero superato (default di piattaforma) -> BLOCCATO', async () => {
  const supabase = makeFakeSupabase({
    tenants: [{ id: TENANT_A, ai_daily_budget_usd: null, ai_monthly_budget_usd: null }],
    ai_usage: [{ id: 'u1', tenant_id: TENANT_A, cost_usd: DEFAULT_DAILY_BUDGET_USD, created_at: isoHoursAgo(1) }],
  });
  const result = await checkAiBudget(supabase, TENANT_A);
  assert.equal(result.ok, false);
  assert.equal(result.scope, 'daily');
});

test('checkAiBudget: budget mensile superato pur restando sotto il tetto giornaliero -> BLOCCATO', async () => {
  const supabase = makeFakeSupabase({
    tenants: [{ id: TENANT_A, ai_daily_budget_usd: null, ai_monthly_budget_usd: 2 }],
    ai_usage: [{ id: 'u1', tenant_id: TENANT_A, cost_usd: 2.5, created_at: isoEarlierThisMonthNotToday() }],
  });
  const result = await checkAiBudget(supabase, TENANT_A);
  assert.equal(result.ok, false);
  assert.equal(result.scope, 'monthly');
});

test('checkAiBudget: spesa del mese scorso non conta nel tetto mensile corrente', async () => {
  const supabase = makeFakeSupabase({
    tenants: [{ id: TENANT_A, ai_daily_budget_usd: null, ai_monthly_budget_usd: 1 }],
    ai_usage: [{ id: 'u1', tenant_id: TENANT_A, cost_usd: 999, created_at: isoDaysAgo(45) }],
  });
  const result = await checkAiBudget(supabase, TENANT_A);
  assert.equal(result.ok, true);
});

test('resolveTenantIdForApp: risolve il tenant_id di un\'app esistente, null se assente', async () => {
  const supabase = makeFakeSupabase({ apps: [{ id: 'app-1', tenant_id: TENANT_A }] });
  assert.equal(await resolveTenantIdForApp(supabase, 'app-1'), TENANT_A);
  assert.equal(await resolveTenantIdForApp(supabase, undefined), null);
  assert.equal(await resolveTenantIdForApp(supabase, 'non-esiste'), null);
});

test('isolamento tenant: il tenant A oltre budget non blocca il tenant B', async () => {
  const supabase = makeFakeSupabase({
    tenants: [
      { id: TENANT_A, ai_daily_budget_usd: 1, ai_monthly_budget_usd: null },
      { id: TENANT_B, ai_daily_budget_usd: 1, ai_monthly_budget_usd: null },
    ],
    ai_usage: [{ id: 'u1', tenant_id: TENANT_A, cost_usd: 5, created_at: isoHoursAgo(1) }],
  });
  const resultA = await checkAiBudget(supabase, TENANT_A);
  const resultB = await checkAiBudget(supabase, TENANT_B);
  assert.equal(resultA.ok, false);
  assert.equal(resultB.ok, true);
});
