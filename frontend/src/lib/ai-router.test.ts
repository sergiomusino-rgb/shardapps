// ─── Test: AI Router — budget, timeout, retry, circuit breaker (Pre-Beta Hardening) ──
// Nessuna chiamata di rete reale verso OpenRouter: global.fetch è sempre
// sostituito da un mock locale, ripristinato dopo ogni test. Nessuna chiamata
// reale verso Supabase: solo il fake in-memory (test-helpers/fake-supabase.ts),
// mai passato implicitamente (i test che non passano supabaseClient/tenantId
// non toccano affatto il path Supabase, vedi ai-router.ts::callAiRouter).
//
// Le env var che ai-router.ts legge una sola volta a module-load (timeout,
// backoff, soglia circuit breaker) sono impostate PRIMA dell'import dinamico
// del modulo, cosi' i test restano rapidi e deterministici invece di
// aspettare i default di produzione (30s di timeout, 5 fallimenti per aprire
// il circuito).

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeSupabase } from './test-helpers/fake-supabase.ts';

process.env.OPENROUTER_API_KEY = 'test-key';
process.env.AI_ROUTER_TIMEOUT_MS = '50';
process.env.AI_ROUTER_RETRY_BACKOFF_MS = '5';
process.env.AI_CIRCUIT_BREAKER_THRESHOLD = '3';
process.env.AI_CIRCUIT_BREAKER_COOLDOWN_MS = '200';

const {
  callAiRouter,
  AiBudgetExceededError,
  AiCircuitOpenError,
  AiTimeoutError,
  AiRouterError,
  __resetAiRouterCircuitBreakerForTests,
} = await import('./ai-router.ts');

beforeEach(() => {
  __resetAiRouterCircuitBreakerForTests();
});

const originalFetch = globalThis.fetch;
function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: 'risposta di test' } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, cost: 0.001 },
    }),
  } as unknown as Response;
}

function errorResponse(status: number): Response {
  return { ok: false, status, json: async () => ({ error: { message: `errore ${status}` } }) } as unknown as Response;
}

function timeoutError(): Error {
  const e = new Error('The operation was aborted due to timeout');
  e.name = 'TimeoutError';
  return e;
}

function installFetchSequence(handlers: Array<() => Promise<Response> | Response>): { callCount: () => number } {
  let i = 0;
  globalThis.fetch = (async () => {
    const handler = handlers[Math.min(i, handlers.length - 1)];
    i += 1;
    return handler();
  }) as typeof fetch;
  return { callCount: () => i };
}

// ─── Timeout ────────────────────────────────────────────────────────────────

test('timeout: fetch che non risponde mai -> AiTimeoutError dopo il retry, mai un hang indefinito', async () => {
  const tracker = installFetchSequence([() => { throw timeoutError(); }]);
  try {
    await assert.rejects(
      () => callAiRouter({ task: 'chat', messages: [{ role: 'user', content: 'ciao' }] }),
      (err: unknown) => err instanceof AiTimeoutError
    );
    assert.equal(tracker.callCount(), 2, 'un tentativo + un retry, mai di più');
  } finally {
    restoreFetch();
  }
});

// ─── Retry su errori transitori ─────────────────────────────────────────────

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

test('400 -> NESSUN retry (errore permanente, riprovarlo non cambierebbe nulla)', async () => {
  const tracker = installFetchSequence([() => errorResponse(400)]);
  try {
    await assert.rejects(
      () => callAiRouter({ task: 'chat', messages: [{ role: 'user', content: 'ciao' }] }),
      (err: unknown) => err instanceof AiRouterError && !(err instanceof AiTimeoutError)
    );
    assert.equal(tracker.callCount(), 1, 'nessun secondo tentativo su un errore permanente');
  } finally {
    restoreFetch();
  }
});

test('secondo fallimento consecutivo -> errore finale (mai un terzo tentativo, massimo 1 retry)', async () => {
  const tracker = installFetchSequence([() => errorResponse(500), () => errorResponse(503)]);
  try {
    await assert.rejects(
      () => callAiRouter({ task: 'chat', messages: [{ role: 'user', content: 'ciao' }] }),
      (err: unknown) => err instanceof AiRouterError
    );
    assert.equal(tracker.callCount(), 2);
  } finally {
    restoreFetch();
  }
});

// ─── Osservabilità: content vuoto / zero token (P0 Generation Reliability, FIX 3) ──
// Root-cause dimostrata live: il provider può rispondere 2xx con
// choices[0].message.content vuoto e usage.total_tokens=0 — nessun errore
// HTTP, quindi mai intercettato da isTransientFailure/retry. Prima di questo
// fix, l'unica traccia era l'eccezione generica di extractJsonFromAiContent
// più a valle, senza alcun contesto su COSA fosse arrivato dal provider.

function emptyContentResponse(overrides: Record<string, unknown> = {}): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      ...overrides,
    }),
  } as unknown as Response;
}

test('content vuoto/zero token: callAiRouter NON lancia (non è un errore HTTP) — il content vuoto risale al chiamante invariato', async () => {
  installFetchSequence([() => emptyContentResponse()]);
  try {
    const result = await callAiRouter({ task: 'app-generation', messages: [{ role: 'user', content: 'genera' }] });
    assert.equal(result.content, '');
    assert.equal(result.usage.totalTokens, 0);
  } finally {
    restoreFetch();
  }
});

test('content vuoto/zero token: viene loggato un warning diagnostico con task/tier/model/finishReason/usage, MAI messages/apiKey', async (t) => {
  installFetchSequence([() => emptyContentResponse()]);
  const warnMock = t.mock.method(console, 'warn');
  try {
    await callAiRouter({ task: 'app-generation', messages: [{ role: 'user', content: 'dati cliente sensibili qui' }] });

    const diagnosticCall = warnMock.mock.calls.find((c) => typeof c.arguments[0] === 'string' && c.arguments[0].includes('content vuoto o zero token'));
    assert.ok(diagnosticCall, 'atteso un console.warn diagnostico per content vuoto/zero token');
    const payload = diagnosticCall.arguments[1] as Record<string, unknown>;
    assert.equal(payload.task, 'app-generation');
    assert.equal(payload.tier, 'advanced');
    assert.equal(payload.hasContent, false);
    assert.equal(payload.finishReason, 'stop');
    assert.equal(payload.usagePresent, true);
    assert.equal(payload.httpStatus, 200);

    // Nessun dato sensibile nel payload loggato: né il prompt utente, né
    // l'API key/Authorization (mai passati a questo punto del codice).
    const serialized = JSON.stringify(payload);
    assert.ok(!serialized.includes('dati cliente sensibili'), 'il prompt utente non deve mai comparire nel log diagnostico');
    assert.ok(!('apiKey' in payload) && !('authorization' in payload) && !('Authorization' in payload));
  } finally {
    restoreFetch();
  }
});

test('content presente/token>0: NESSUN warning diagnostico (solo il path del content vuoto lo produce)', async (t) => {
  installFetchSequence([() => okResponse()]);
  const warnMock = t.mock.method(console, 'warn');
  try {
    await callAiRouter({ task: 'chat', messages: [{ role: 'user', content: 'ciao' }] });
    const diagnosticCall = warnMock.mock.calls.find((c) => typeof c.arguments[0] === 'string' && c.arguments[0].includes('content vuoto o zero token'));
    assert.equal(diagnosticCall, undefined);
  } finally {
    restoreFetch();
  }
});

// ─── Circuit breaker ────────────────────────────────────────────────────────

test('circuit breaker: si apre dopo N fallimenti consecutivi e blocca SENZA chiamare il provider', async () => {
  // Soglia impostata a 3 via env in testa al file: 3 chiamate che falliscono
  // definitivamente (2 fetch ciascuna, 1 tentativo + 1 retry) aprono il
  // circuito; la 4a chiamata deve fallire SENZA alcuna nuova fetch.
  const tracker = installFetchSequence([() => errorResponse(500)]);
  try {
    for (let i = 0; i < 3; i++) {
      await assert.rejects(() => callAiRouter({ task: 'chat', messages: [{ role: 'user', content: 'x' }] }));
    }
    const callsBeforeOpen = tracker.callCount();
    assert.equal(callsBeforeOpen, 6, '3 chiamate x (1 tentativo + 1 retry)');

    await assert.rejects(
      () => callAiRouter({ task: 'chat', messages: [{ role: 'user', content: 'x' }] }),
      (err: unknown) => err instanceof AiCircuitOpenError
    );
    assert.equal(tracker.callCount(), callsBeforeOpen, 'il circuito aperto non genera alcuna nuova fetch verso il provider');
  } finally {
    restoreFetch();
  }
});

test('circuit breaker: una chiamata riuscita azzera il contatore (non rompe il funzionamento normale)', async () => {
  const tracker = installFetchSequence([
    () => errorResponse(500), () => errorResponse(500), // chiamata 1: fallisce (2 fetch)
    () => okResponse(), // chiamata 2: riesce al primo colpo -> reset
    () => errorResponse(500), () => errorResponse(500), // chiamata 3: fallisce di nuovo
    () => errorResponse(500), () => errorResponse(500), // chiamata 4: fallisce di nuovo (2 fallimenti consecutivi, sotto soglia 3)
  ]);
  try {
    await assert.rejects(() => callAiRouter({ task: 'chat', messages: [{ role: 'user', content: 'x' }] }));
    const ok = await callAiRouter({ task: 'chat', messages: [{ role: 'user', content: 'x' }] });
    assert.equal(ok.content, 'risposta di test');
    await assert.rejects(() => callAiRouter({ task: 'chat', messages: [{ role: 'user', content: 'x' }] }));
    // Ancora un AiRouterError "normale", non AiCircuitOpenError: il successo
    // di mezzo ha azzerato il contatore, servono altri 3 fallimenti pieni.
    await assert.rejects(
      () => callAiRouter({ task: 'chat', messages: [{ role: 'user', content: 'x' }] }),
      (err: unknown) => err instanceof AiRouterError && !(err instanceof AiCircuitOpenError)
    );
    assert.equal(tracker.callCount(), 7, '2+1+2+2 fetch attese lungo l\'intero scenario, mai il circuito aperto');
  } finally {
    restoreFetch();
  }
});

// ─── Budget (Blocco 1) — integrazione end-to-end con callAiRouter ───────────

const TENANT_OVER_BUDGET = 'tenant-over-budget';
const TENANT_OK = 'tenant-ok';

test('budget: tenant oltre il tetto giornaliero -> AiBudgetExceededError, provider MAI chiamato', async () => {
  const fakeSupabase = makeFakeSupabase({}, {
    tenants: [{ id: TENANT_OVER_BUDGET, ai_daily_budget_usd: 1, ai_monthly_budget_usd: null }],
    ai_usage: [{ id: 'u1', tenant_id: TENANT_OVER_BUDGET, cost_usd: 5, created_at: new Date().toISOString() }],
  });
  const tracker = installFetchSequence([() => okResponse()]);
  try {
    await assert.rejects(
      () => callAiRouter({
        task: 'chat',
        messages: [{ role: 'user', content: 'x' }],
        context: { tenantId: TENANT_OVER_BUDGET },
        supabaseClient: fakeSupabase,
      }),
      (err: unknown) => err instanceof AiBudgetExceededError && (err as InstanceType<typeof AiBudgetExceededError>).scope === 'daily'
    );
    assert.equal(tracker.callCount(), 0, 'una richiesta bloccata dal budget non deve MAI raggiungere OpenRouter');
  } finally {
    restoreFetch();
  }
});

test('budget: tenant oltre il tetto mensile -> AiBudgetExceededError, provider MAI chiamato', async () => {
  const now = new Date();
  const midMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) + 60 * 60 * 1000).toISOString();
  const fakeSupabase = makeFakeSupabase({}, {
    tenants: [{ id: TENANT_OVER_BUDGET, ai_daily_budget_usd: null, ai_monthly_budget_usd: 1 }],
    ai_usage: [{ id: 'u1', tenant_id: TENANT_OVER_BUDGET, cost_usd: 5, created_at: midMonth }],
  });
  const tracker = installFetchSequence([() => okResponse()]);
  try {
    await assert.rejects(
      () => callAiRouter({
        task: 'chat',
        messages: [{ role: 'user', content: 'x' }],
        context: { tenantId: TENANT_OVER_BUDGET },
        supabaseClient: fakeSupabase,
      }),
      (err: unknown) => err instanceof AiBudgetExceededError
    );
    assert.equal(tracker.callCount(), 0);
  } finally {
    restoreFetch();
  }
});

test('budget: isolamento tenant — un tenant sotto budget non è mai influenzato da un altro tenant oltre budget', async () => {
  const fakeSupabase = makeFakeSupabase({}, {
    tenants: [
      { id: TENANT_OVER_BUDGET, ai_daily_budget_usd: 1, ai_monthly_budget_usd: null },
      { id: TENANT_OK, ai_daily_budget_usd: 1, ai_monthly_budget_usd: null },
    ],
    ai_usage: [{ id: 'u1', tenant_id: TENANT_OVER_BUDGET, cost_usd: 5, created_at: new Date().toISOString() }],
  });
  const tracker = installFetchSequence([() => okResponse()]);
  try {
    const result = await callAiRouter({
      task: 'chat',
      messages: [{ role: 'user', content: 'x' }],
      context: { tenantId: TENANT_OK },
      supabaseClient: fakeSupabase,
    });
    assert.equal(result.content, 'risposta di test');
    assert.equal(tracker.callCount(), 1);
  } finally {
    restoreFetch();
  }
});

test('registrazione usage: una chiamata riuscita con tenantId persiste una riga in ai_usage con il costo reale', async () => {
  const fakeSupabase = makeFakeSupabase({}, { tenants: [{ id: TENANT_OK }] });
  installFetchSequence([() => okResponse()]);
  try {
    await callAiRouter({
      task: 'chat',
      messages: [{ role: 'user', content: 'x' }],
      context: { tenantId: TENANT_OK, appId: 'app-1', userId: 'user-1' },
      supabaseClient: fakeSupabase,
    });
    const { data } = await fakeSupabase.from('ai_usage').select('*').eq('tenant_id', TENANT_OK);
    assert.equal((data as unknown[]).length, 1);
    const row = (data as Record<string, unknown>[])[0];
    assert.equal(row.cost_usd, 0.001);
    assert.equal(row.total_tokens, 30);
    assert.equal(row.app_id, 'app-1');
    assert.equal(row.task, 'chat');
    assert.equal(row.provider, 'openrouter');
  } finally {
    restoreFetch();
  }
});

test('nessun tenantId/appId risolvibile -> nessun budget applicato, la chiamata procede normalmente (compatibilità chiamanti legacy)', async () => {
  const tracker = installFetchSequence([() => okResponse()]);
  try {
    const result = await callAiRouter({ task: 'chat', messages: [{ role: 'user', content: 'x' }] });
    assert.equal(result.content, 'risposta di test');
    assert.equal(tracker.callCount(), 1);
  } finally {
    restoreFetch();
  }
});
