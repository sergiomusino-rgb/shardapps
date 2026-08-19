// ─── Test: action-dispatcher — retry webhook (Pre-Beta Hardening, Blocco 8) ─
// Nessuna chiamata di rete reale: global.fetch è sempre mockato, e
// dns.promises.lookup è mockato con t.mock.method (stesso identico pattern
// di ssrf-guard.test.js) per rendere ogni URL "pubblico" senza dipendere da
// una vera risoluzione DNS. WEBHOOK_RETRY_BACKOFF_MS impostato PRIMA del
// require (letto una sola volta a module-load) per rendere i test rapidi.
'use strict';
process.env.WEBHOOK_RETRY_BACKOFF_MS = '5';

const test = require('node:test');
const assert = require('node:assert/strict');
const dns = require('node:dns');
const { deliverWebhookWithRetry, attemptWebhookDelivery, MAX_WEBHOOK_RETRIES, sanitizeHttpActionHeaders } = require('./action-dispatcher');

const originalFetch = globalThis.fetch;
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function mockPublicDns(t) {
  t.mock.method(dns.promises, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
}

function okResponse(status = 200) {
  return { ok: true, status };
}
function errorResponse(status) {
  return { ok: false, status };
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

const SAFE_URL = 'https://webhook.esempio-agenzia.test/hook';

test('successo al primo tentativo: nessun retry, 1 sola chiamata', async (t) => {
  mockPublicDns(t);
  const tracker = installFetchSequence([() => okResponse()]);
  try {
    const result = await deliverWebhookWithRetry(SAFE_URL, { x: 1 });
    assert.equal(result.delivered, true);
    assert.equal(result.attempts, 1);
    assert.equal(tracker.callCount(), 1);
  } finally {
    restoreFetch();
  }
});

test('500 -> retry -> successo al secondo tentativo', async (t) => {
  mockPublicDns(t);
  const tracker = installFetchSequence([() => errorResponse(500), () => okResponse()]);
  try {
    const result = await deliverWebhookWithRetry(SAFE_URL, {});
    assert.equal(result.delivered, true);
    assert.equal(result.attempts, 2);
    assert.equal(tracker.callCount(), 2);
  } finally {
    restoreFetch();
  }
});

test('429 -> retry -> successo', async (t) => {
  mockPublicDns(t);
  const tracker = installFetchSequence([() => errorResponse(429), () => okResponse()]);
  try {
    const result = await deliverWebhookWithRetry(SAFE_URL, {});
    assert.equal(result.delivered, true);
    assert.equal(tracker.callCount(), 2);
  } finally {
    restoreFetch();
  }
});

test('timeout -> retry -> successo', async (t) => {
  mockPublicDns(t);
  const tracker = installFetchSequence([() => { throw timeoutError(); }, () => okResponse()]);
  try {
    const result = await deliverWebhookWithRetry(SAFE_URL, {});
    assert.equal(result.delivered, true);
    assert.equal(tracker.callCount(), 2);
  } finally {
    restoreFetch();
  }
});

test('400 -> NESSUN retry (errore permanente, riprovarlo non cambierebbe nulla)', async (t) => {
  mockPublicDns(t);
  const tracker = installFetchSequence([() => errorResponse(400)]);
  try {
    const result = await deliverWebhookWithRetry(SAFE_URL, {});
    assert.equal(result.delivered, false);
    assert.equal(result.attempts, 1);
    assert.equal(tracker.callCount(), 1, 'nessun secondo tentativo su un 400');
  } finally {
    restoreFetch();
  }
});

test('404 -> NESSUN retry', async (t) => {
  mockPublicDns(t);
  const tracker = installFetchSequence([() => errorResponse(404)]);
  try {
    await deliverWebhookWithRetry(SAFE_URL, {});
    assert.equal(tracker.callCount(), 1);
  } finally {
    restoreFetch();
  }
});

test(`fallimenti persistenti -> si ferma dopo ${1 + MAX_WEBHOOK_RETRIES} tentativi (massimo ${MAX_WEBHOOK_RETRIES} retry, mai un loop)`, async (t) => {
  mockPublicDns(t);
  const tracker = installFetchSequence([() => errorResponse(503)]);
  try {
    const result = await deliverWebhookWithRetry(SAFE_URL, {});
    assert.equal(result.delivered, false);
    assert.equal(result.attempts, 1 + MAX_WEBHOOK_RETRIES);
    assert.equal(tracker.callCount(), 1 + MAX_WEBHOOK_RETRIES);
  } finally {
    restoreFetch();
  }
});

test('URL privato/riservato bloccato dall\'SSRF guard -> nessuna fetch eseguita, nessun retry', async () => {
  // Nessun mock dns necessario: 127.0.0.1 è già un IP letterale privato,
  // isPrivateOrReservedIp lo riconosce senza dover risolvere nulla.
  const tracker = installFetchSequence([() => okResponse()]);
  try {
    const result = await attemptWebhookDelivery('http://127.0.0.1:9999/hook', {});
    assert.equal(result.delivered, false);
    assert.equal(result.blocked, true);
    assert.match(result.error, /SSRF guard/);
    assert.equal(tracker.callCount(), 0, 'un blocco SSRF non deve mai raggiungere il fetch');
  } finally {
    restoreFetch();
  }
});

test('deliverWebhookWithRetry: blocco SSRF -> nessun retry (deterministico, non un guasto transitorio)', async () => {
  const tracker = installFetchSequence([() => okResponse()]);
  try {
    const result = await deliverWebhookWithRetry('http://169.254.169.254/latest/meta-data', {});
    assert.equal(result.delivered, false);
    assert.equal(result.blocked, true);
    assert.equal(result.attempts, 1);
    assert.equal(tracker.callCount(), 0);
  } finally {
    restoreFetch();
  }
});

test('redirect (3xx) non seguito -> trattato come fallimento, nessun retry (non un guasto transitorio del target)', async (t) => {
  mockPublicDns(t);
  const tracker = installFetchSequence([() => errorResponse(301)]);
  try {
    const result = await deliverWebhookWithRetry(SAFE_URL, {});
    assert.equal(result.delivered, false);
    assert.match(result.error, /Redirect non seguito/);
    assert.equal(tracker.callCount(), 1);
  } finally {
    restoreFetch();
  }
});

test('ogni tentativo ri-valida SSRF da capo: un target che diventa privato tra un retry e l\'altro viene bloccato', async (t) => {
  let lookupCall = 0;
  t.mock.method(dns.promises, 'lookup', async () => {
    lookupCall += 1;
    // Primo tentativo: pubblico (passa, ma il fetch fallisce con 500 ->
    // transitorio -> retry). Secondo tentativo: la risoluzione è "cambiata"
    // (DNS rebinding) verso un indirizzo privato -> bloccato, mai una fetch.
    return lookupCall === 1 ? [{ address: '8.8.8.8', family: 4 }] : [{ address: '10.0.0.1', family: 4 }];
  });
  const tracker = installFetchSequence([() => errorResponse(500)]);
  try {
    const result = await deliverWebhookWithRetry(SAFE_URL, {});
    assert.equal(result.delivered, false);
    assert.equal(result.blocked, true);
    assert.equal(tracker.callCount(), 1, 'il secondo tentativo è stato bloccato PRIMA di arrivare al fetch');
  } finally {
    restoreFetch();
  }
});

// ─── sanitizeHttpActionHeaders (Integrations Round 2) ──────────────────────

test('sanitizeHttpActionHeaders: mantiene header validi', () => {
  assert.deepEqual(sanitizeHttpActionHeaders({ Authorization: 'Bearer xyz', 'X-Custom': 'val' }), { Authorization: 'Bearer xyz', 'X-Custom': 'val' });
});

test('sanitizeHttpActionHeaders: rimuove Host/Content-Length/Content-Type indipendentemente da maiuscole/minuscole', () => {
  const result = sanitizeHttpActionHeaders({ HOST: 'evil.test', 'Content-Length': '999', 'content-type': 'text/html', Authorization: 'Bearer ok' });
  assert.deepEqual(result, { Authorization: 'Bearer ok' });
});

test('sanitizeHttpActionHeaders: limita al massimo MAX_HTTP_ACTION_HEADERS (10) header', () => {
  const many = {};
  for (let i = 0; i < 25; i++) many[`X-Header-${i}`] = String(i);
  const result = sanitizeHttpActionHeaders(many);
  assert.equal(Object.keys(result).length, 10);
});

test('sanitizeHttpActionHeaders: scarta valori non stringa e input assente/malformato', () => {
  assert.deepEqual(sanitizeHttpActionHeaders({ 'X-Num': 5, 'X-Bool': true, 'X-Obj': { a: 1 }, 'X-Ok': 'ok' }), { 'X-Ok': 'ok' });
  assert.deepEqual(sanitizeHttpActionHeaders(null), {});
  assert.deepEqual(sanitizeHttpActionHeaders(undefined), {});
});

// ─── attemptWebhookDelivery/deliverWebhookWithRetry con options (http_request) ─
// Stesso motore di trigger_webhook, ma con method/headers/body configurabili:
// questi test verificano che le opzioni arrivino intatte al fetch reale (mai
// silenziosamente ignorate) e che i vincoli di sicurezza (Content-Type deciso
// qui, mai dall'azione) restino validi anche col nuovo path.

test('http_request: GET non invia body, anche se options.body è valorizzato', async (t) => {
  mockPublicDns(t);
  let capturedInit;
  globalThis.fetch = async (url, init) => { capturedInit = init; return okResponse(); };
  try {
    await attemptWebhookDelivery(SAFE_URL, { ignored: true }, { method: 'GET', body: 'should-be-ignored' });
    assert.equal(capturedInit.method, 'GET');
    assert.equal('body' in capturedInit, false);
  } finally {
    restoreFetch();
  }
});

test('http_request: DELETE non invia body (stesso trattamento di GET)', async (t) => {
  mockPublicDns(t);
  let capturedInit;
  globalThis.fetch = async (url, init) => { capturedInit = init; return okResponse(); };
  try {
    await attemptWebhookDelivery(SAFE_URL, {}, { method: 'DELETE' });
    assert.equal('body' in capturedInit, false);
  } finally {
    restoreFetch();
  }
});

test('http_request: PUT con body stringa esplicito -> Content-Type text/plain di default, body invariato', async (t) => {
  mockPublicDns(t);
  let capturedInit;
  globalThis.fetch = async (url, init) => { capturedInit = init; return okResponse(); };
  try {
    await attemptWebhookDelivery(SAFE_URL, { fallback: true }, { method: 'PUT', body: 'testo semplice' });
    assert.equal(capturedInit.method, 'PUT');
    assert.equal(capturedInit.body, 'testo semplice');
    assert.equal(capturedInit.headers['Content-Type'], 'text/plain');
  } finally {
    restoreFetch();
  }
});

test('http_request: header custom (es. Authorization) arrivano al fetch reale', async (t) => {
  mockPublicDns(t);
  let capturedInit;
  globalThis.fetch = async (url, init) => { capturedInit = init; return okResponse(); };
  try {
    await attemptWebhookDelivery(SAFE_URL, {}, { method: 'POST', headers: { Authorization: 'Bearer secret-token' } });
    assert.equal(capturedInit.headers.Authorization, 'Bearer secret-token');
  } finally {
    restoreFetch();
  }
});

test('http_request: senza options -> comportamento IDENTICO a trigger_webhook (POST + JSON del payload, invariato)', async (t) => {
  mockPublicDns(t);
  let capturedInit;
  globalThis.fetch = async (url, init) => { capturedInit = init; return okResponse(); };
  try {
    await attemptWebhookDelivery(SAFE_URL, { hello: 'world' });
    assert.equal(capturedInit.method, 'POST');
    assert.equal(capturedInit.headers['Content-Type'], 'application/json');
    assert.equal(capturedInit.body, JSON.stringify({ hello: 'world' }));
  } finally {
    restoreFetch();
  }
});

test('http_request: URL privato bloccato anche con method/headers custom (SSRF guard indipendente dalle options)', async () => {
  const tracker = installFetchSequence([() => okResponse()]);
  try {
    const result = await attemptWebhookDelivery('http://127.0.0.1:9999/hook', {}, { method: 'PATCH', headers: { Authorization: 'Bearer x' } });
    assert.equal(result.delivered, false);
    assert.equal(result.blocked, true);
    assert.equal(tracker.callCount(), 0);
  } finally {
    restoreFetch();
  }
});
