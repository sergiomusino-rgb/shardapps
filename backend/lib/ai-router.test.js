// ─── Test: AI Router — budget, timeout, retry, circuit breaker (Pre-Beta Hardening) ──
// Stessa struttura della controparte frontend (src/lib/ai-router.test.ts):
// nessuna chiamata di rete reale (global.fetch sempre mockato), nessuna
// chiamata Supabase reale (solo il fake in-memory quando esplicitamente
// passato). require() è sincrono: le env var che ai-router.js legge una sola
// volta a module-load sono impostate PRIMA del require, non dopo.
'use strict';

process.env.OPENROUTER_API_KEY = 'test-key';
process.env.AI_ROUTER_TIMEOUT_MS = '50';
process.env.AI_ROUTER_RETRY_BACKOFF_MS = '5';
process.env.AI_CIRCUIT_BREAKER_THRESHOLD = '3';
process.env.AI_CIRCUIT_BREAKER_COOLDOWN_MS = '200';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeSupabase } = require('./test-helpers/fake-supabase');
const {
  callAiRouter,
  AiBudgetExceededError,
  AiCircuitOpenError,
  AiTimeoutError,
  AiRouterError,
  __resetAiRouterCircuitBreakerForTests,
} = require('./ai-router');

beforeEach(() => {
  __resetAiRouterCircuitBreakerForTests();
});

const originalFetch = globalThis.fetch;
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function okResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: 'risposta di test' } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, cost: 0.001 },
    }),
  };
}

function errorResponse(status) {
  return { ok: false, status, json: async () => ({ error: { message: `errore ${status}` } }) };
}

function timeoutError() {
  const e = new Error('The operation was aborted due to timeout');
  e.name = 'TimeoutError';
  return e;
}

function installFetchSequence(handlers) {
  let i = 0;
  globalThis.fetch = async () => {
    const handler = handlers[Math.min(i, handlers.length - 1)];
    i += 1;
    return handler();
  };
  return { callCount: () => i };
}

test('timeout: fetch che non risponde mai -> AiTimeoutError dopo il retry', async () => {
  const tracker = installFetchSequence([() => { throw timeoutError(); }]);
  try {
    await assert.rejects(
      () => callAiRouter({ task: 'chat', messages: [{ role: 'user', content: 'ciao' }] }),
      (err) => err instanceof AiTimeoutError
    );
    assert.equal(tracker.callCount(), 2);
  } finally {
    restoreFetch();
  }
});

test('429 -> retry -> successo al secondo tentativo', async () => {
  const tracker = installFetchSequence([() => errorResponse(429), () => okResponse()]);
  try {
    const result = await callAiRouter({ task: 'chat', messages: [{ role: 'user', content: 'ciao' }] });
    assert.equal(result.content, 'risposta di test');
    assert.equal(tracker.callCount(), 2);
  } finally {
    restoreFetch();
  }
});

test('500 -> retry -> successo al secondo tentativo', async () => {
  const tracker = installFetchSequence([() => errorResponse(500), () => okResponse()]);
  try {
    const result = await callAiRouter({ task: 'chat', messages: [{ role: 'user', content: 'ciao' }] });
    assert.equal(result.content, 'risposta di test');
    assert.equal(tracker.callCount(), 2);
  } finally {
    restoreFetch();
  }
});

test('400 -> nessun retry', async () => {
  const tracker = installFetchSequence([() => errorResponse(400)]);
  try {
    await assert.rejects(
      () => callAiRouter({ task: 'chat', messages: [{ role: 'user', content: 'ciao' }] }),
      (err) => err instanceof AiRouterError && !(err instanceof AiTimeoutError)
    );
    assert.equal(tracker.callCount(), 1);
  } finally {
    restoreFetch();
  }
});

test('secondo fallimento consecutivo -> errore finale', async () => {
  const tracker = installFetchSequence([() => errorResponse(500), () => errorResponse(503)]);
  try {
    await assert.rejects(
      () => callAiRouter({ task: 'chat', messages: [{ role: 'user', content: 'ciao' }] }),
      (err) => err instanceof AiRouterError
    );
    assert.equal(tracker.callCount(), 2);
  } finally {
    restoreFetch();
  }
});

test('circuit breaker: si apre dopo N fallimenti consecutivi e blocca senza chiamare il provider', async () => {
  const tracker = installFetchSequence([() => errorResponse(500)]);
  try {
    for (let i = 0; i < 3; i++) {
      await assert.rejects(() => callAiRouter({ task: 'chat', messages: [{ role: 'user', content: 'x' }] }));
    }
    const callsBeforeOpen = tracker.callCount();
    assert.equal(callsBeforeOpen, 6);
    await assert.rejects(
      () => callAiRouter({ task: 'chat', messages: [{ role: 'user', content: 'x' }] }),
      (err) => err instanceof AiCircuitOpenError
    );
    assert.equal(tracker.callCount(), callsBeforeOpen);
  } finally {
    restoreFetch();
  }
});

const TENANT_OVER_BUDGET = 'tenant-over-budget';
const TENANT_OK = 'tenant-ok';

test('budget: tenant oltre il tetto giornaliero -> AiBudgetExceededError, provider MAI chiamato', async () => {
  const fakeSupabase = makeFakeSupabase({
    tenants: [{ id: TENANT_OVER_BUDGET, ai_daily_budget_usd: 1, ai_monthly_budget_usd: null }],
    ai_usage: [{ id: 'u1', tenant_id: TENANT_OVER_BUDGET, cost_usd: 5, created_at: new Date().toISOString() }],
  });
  const tracker = installFetchSequence([() => okResponse()]);
  try {
    await assert.rejects(
      () => callAiRouter({
        task: 'chat', messages: [{ role: 'user', content: 'x' }],
        context: { tenantId: TENANT_OVER_BUDGET }, supabaseClient: fakeSupabase,
      }),
      (err) => err instanceof AiBudgetExceededError && err.scope === 'daily'
    );
    assert.equal(tracker.callCount(), 0);
  } finally {
    restoreFetch();
  }
});

test('budget: isolamento tenant', async () => {
  const fakeSupabase = makeFakeSupabase({
    tenants: [
      { id: TENANT_OVER_BUDGET, ai_daily_budget_usd: 1, ai_monthly_budget_usd: null },
      { id: TENANT_OK, ai_daily_budget_usd: 1, ai_monthly_budget_usd: null },
    ],
    ai_usage: [{ id: 'u1', tenant_id: TENANT_OVER_BUDGET, cost_usd: 5, created_at: new Date().toISOString() }],
  });
  const tracker = installFetchSequence([() => okResponse()]);
  try {
    const result = await callAiRouter({
      task: 'chat', messages: [{ role: 'user', content: 'x' }],
      context: { tenantId: TENANT_OK }, supabaseClient: fakeSupabase,
    });
    assert.equal(result.content, 'risposta di test');
    assert.equal(tracker.callCount(), 1);
  } finally {
    restoreFetch();
  }
});

test('registrazione usage: una chiamata riuscita persiste una riga in ai_usage', async () => {
  const fakeSupabase = makeFakeSupabase({ tenants: [{ id: TENANT_OK }] });
  installFetchSequence([() => okResponse()]);
  try {
    await callAiRouter({
      task: 'chat', messages: [{ role: 'user', content: 'x' }],
      context: { tenantId: TENANT_OK, appId: 'app-1' }, supabaseClient: fakeSupabase,
    });
    const { data } = await fakeSupabase.from('ai_usage').select().eq('tenant_id', TENANT_OK);
    assert.equal(data.length, 1);
    assert.equal(data[0].cost_usd, 0.001);
    assert.equal(data[0].app_id, 'app-1');
  } finally {
    restoreFetch();
  }
});

test('nessun tenantId/appId -> nessun budget applicato, chiamata legacy invariata', async () => {
  const tracker = installFetchSequence([() => okResponse()]);
  try {
    const result = await callAiRouter({ task: 'chat', messages: [{ role: 'user', content: 'x' }] });
    assert.equal(result.content, 'risposta di test');
    assert.equal(tracker.callCount(), 1);
  } finally {
    restoreFetch();
  }
});
