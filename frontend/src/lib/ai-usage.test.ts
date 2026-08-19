// ─── Test: AI Usage tracking + budget enforcement (Pre-Beta Hardening) ─────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeSupabase } from './test-helpers/fake-supabase.ts';
import {
  checkAiBudget,
  recordAiUsage,
  resolveTenantIdForApp,
  DEFAULT_DAILY_BUDGET_USD,
} from './ai-usage.ts';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

// Un istante compreso nel mese corrente ma precedente all'inizio di oggi —
// costruito relativo a "adesso" (mai una data fissa) così il test resta
// corretto in qualunque giorno venga eseguito, incluso vicino ai confini di
// mese (l'unico caso limite non coperto è l'esecuzione esattamente il primo
// giorno del mese, dove "inizio mese" e "inizio oggi" coincidono).
function isoEarlierThisMonthNotToday(): string {
  const now = new Date();
  const startOfMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(Math.floor((startOfMonth + startOfToday) / 2)).toISOString();
}

test('recordAiUsage: inserisce una riga con tutti i campi attesi', async () => {
  const supabase = makeFakeSupabase();
  await recordAiUsage(supabase, {
    tenantId: TENANT_A,
    appId: 'app-1',
    userId: 'user-1',
    task: 'app-generation',
    provider: 'openrouter',
    model: 'anthropic/claude-sonnet-5',
    inputTokens: 100,
    outputTokens: 200,
    totalTokens: 300,
    costUsd: 0.05,
  });

  const { data } = await supabase.from('ai_usage').select('*').eq('tenant_id', TENANT_A);
  assert.equal(data!.length, 1);
  const row = data![0] as Record<string, unknown>;
  assert.equal(row.tenant_id, TENANT_A);
  assert.equal(row.app_id, 'app-1');
  assert.equal(row.user_id, 'user-1');
  assert.equal(row.task, 'app-generation');
  assert.equal(row.provider, 'openrouter');
  assert.equal(row.model, 'anthropic/claude-sonnet-5');
  assert.equal(row.input_tokens, 100);
  assert.equal(row.output_tokens, 200);
  assert.equal(row.total_tokens, 300);
  assert.equal(row.cost_usd, 0.05);
});

test('recordAiUsage: cost_usd null (provider senza usage.cost) -> riga scritta comunque, mai un costo inventato', async () => {
  const supabase = makeFakeSupabase();
  await recordAiUsage(supabase, {
    tenantId: TENANT_A, task: 'chat', provider: 'openrouter', model: 'x',
    inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: null,
  });
  const { data } = await supabase.from('ai_usage').select('*').eq('tenant_id', TENANT_A);
  assert.equal((data![0] as Record<string, unknown>).cost_usd, null);
});

test('recordAiUsage: tenantId assente -> nessuna riga scritta (nessun tenant a cui addebitarla)', async () => {
  const supabase = makeFakeSupabase();
  await recordAiUsage(supabase, {
    tenantId: '' as unknown as string, task: 'chat', provider: 'openrouter', model: 'x',
    inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0.01,
  });
  const { data } = await supabase.from('ai_usage').select('*');
  assert.equal(data!.length, 0);
});

test('recordAiUsage: errore di insert -> non lancia (telemetria persa, mai un crash della chiamata AI)', async () => {
  const supabase = makeFakeSupabase({}, {}, { forceErrors: { ai_usage: { insert: { message: 'boom' } } } });
  await assert.doesNotReject(() => recordAiUsage(supabase, {
    tenantId: TENANT_A, task: 'chat', provider: 'openrouter', model: 'x',
    inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0.01,
  }));
});

test('checkAiBudget: tenantId assente -> sempre ok (nessun budget applicabile)', async () => {
  const supabase = makeFakeSupabase();
  const result = await checkAiBudget(supabase, undefined);
  assert.equal(result.ok, true);
});

test('checkAiBudget: nessun consumo storico -> ok (sotto i default di piattaforma)', async () => {
  const supabase = makeFakeSupabase();
  const result = await checkAiBudget(supabase, TENANT_A);
  assert.equal(result.ok, true);
});

test('checkAiBudget: budget giornaliero superato -> BLOCCATO (usa il default di piattaforma, tenant senza override)', async () => {
  const supabase = makeFakeSupabase({}, {
    tenants: [{ id: TENANT_A, ai_daily_budget_usd: null, ai_monthly_budget_usd: null }],
    ai_usage: [
      { id: 'u1', tenant_id: TENANT_A, cost_usd: DEFAULT_DAILY_BUDGET_USD, created_at: isoHoursAgo(1) },
    ],
  });
  const result = await checkAiBudget(supabase, TENANT_A);
  assert.equal(result.ok, false);
  assert.equal(result.scope, 'daily');
  assert.equal(result.limitUsd, DEFAULT_DAILY_BUDGET_USD);
});

test('checkAiBudget: budget giornaliero PERSONALIZZATO per tenant, più basso del default -> blocca prima del default', async () => {
  const supabase = makeFakeSupabase({}, {
    tenants: [{ id: TENANT_A, ai_daily_budget_usd: 1, ai_monthly_budget_usd: null }],
    ai_usage: [
      { id: 'u1', tenant_id: TENANT_A, cost_usd: 1, created_at: isoHoursAgo(1) },
    ],
  });
  const result = await checkAiBudget(supabase, TENANT_A);
  assert.equal(result.ok, false);
  assert.equal(result.scope, 'daily');
  assert.equal(result.limitUsd, 1);
});

test('checkAiBudget: sotto il tetto giornaliero ma sopra il tetto mensile -> BLOCCATO su scope mensile', async () => {
  const supabase = makeFakeSupabase({}, {
    tenants: [{ id: TENANT_A, ai_daily_budget_usd: null, ai_monthly_budget_usd: 2 }],
    ai_usage: [
      // Spesa distribuita nel mese ma non oggi: il totale giornaliero resta
      // 0, ma il totale mensile supera il tetto di 2.
      { id: 'u1', tenant_id: TENANT_A, cost_usd: 2.5, created_at: isoEarlierThisMonthNotToday() },
    ],
  });
  const result = await checkAiBudget(supabase, TENANT_A);
  assert.equal(result.ok, false);
  assert.equal(result.scope, 'monthly');
  assert.equal(result.limitUsd, 2);
});

test('checkAiBudget: spesa del mese scorso non conta nel tetto mensile corrente', async () => {
  const supabase = makeFakeSupabase({}, {
    tenants: [{ id: TENANT_A, ai_daily_budget_usd: null, ai_monthly_budget_usd: 1 }],
    ai_usage: [
      { id: 'u1', tenant_id: TENANT_A, cost_usd: 999, created_at: isoDaysAgo(45) },
    ],
  });
  const result = await checkAiBudget(supabase, TENANT_A);
  assert.equal(result.ok, true);
});

test('checkAiBudget: righe con cost_usd null non contano ai fini del budget (mai stimato)', async () => {
  const supabase = makeFakeSupabase({}, {
    tenants: [{ id: TENANT_A, ai_daily_budget_usd: 1, ai_monthly_budget_usd: null }],
    ai_usage: [
      { id: 'u1', tenant_id: TENANT_A, cost_usd: null, created_at: isoHoursAgo(1) },
      { id: 'u2', tenant_id: TENANT_A, cost_usd: null, created_at: isoHoursAgo(2) },
    ],
  });
  const result = await checkAiBudget(supabase, TENANT_A);
  assert.equal(result.ok, true);
});

test('isolamento tenant: il tenant A oltre budget non blocca il tenant B', async () => {
  const supabase = makeFakeSupabase({}, {
    tenants: [
      { id: TENANT_A, ai_daily_budget_usd: 1, ai_monthly_budget_usd: null },
      { id: TENANT_B, ai_daily_budget_usd: 1, ai_monthly_budget_usd: null },
    ],
    ai_usage: [
      { id: 'u1', tenant_id: TENANT_A, cost_usd: 5, created_at: isoHoursAgo(1) },
    ],
  });
  const resultA = await checkAiBudget(supabase, TENANT_A);
  const resultB = await checkAiBudget(supabase, TENANT_B);
  assert.equal(resultA.ok, false);
  assert.equal(resultB.ok, true);
});

test('resolveTenantIdForApp: risolve il tenant_id di un\'app esistente', async () => {
  const supabase = makeFakeSupabase({}, { apps: [{ id: 'app-1', tenant_id: TENANT_A }] });
  const tenantId = await resolveTenantIdForApp(supabase, 'app-1');
  assert.equal(tenantId, TENANT_A);
});

test('resolveTenantIdForApp: appId assente/app inesistente -> null, mai un\'eccezione', async () => {
  const supabase = makeFakeSupabase();
  assert.equal(await resolveTenantIdForApp(supabase, undefined), null);
  assert.equal(await resolveTenantIdForApp(supabase, 'non-esiste'), null);
});

test('checkAiBudget: fail-open su un errore di lettura dello storico (mai bloccare per un problema nostro)', async () => {
  const supabase = makeFakeSupabase({}, { tenants: [{ id: TENANT_A }] }, {
    forceErrors: { ai_usage: { select: { message: 'connessione persa' } } },
  });
  const result = await checkAiBudget(supabase, TENANT_A);
  assert.equal(result.ok, true);
});
