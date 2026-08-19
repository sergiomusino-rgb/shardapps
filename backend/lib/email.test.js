// ─── Test: lib/email.js — invio centralizzato (Notifications Round 2) ──────
// Stesso identico pattern di action-dispatcher.test.js: global.fetch sempre
// mockato, nessuna chiamata di rete reale. RESEND_API_KEY impostata solo nei
// test che devono verificare un invio "tentato" — negli altri resta assente
// (comportamento reale di un ambiente senza il provider configurato).
'use strict';
process.env.EMAIL_RETRY_BACKOFF_MS = '5';

const test = require('node:test');
const assert = require('node:assert/strict');

const originalFetch = globalThis.fetch;
function restoreFetch() {
  globalThis.fetch = originalFetch;
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
function okResponse() {
  return { ok: true, status: 200, text: async () => '' };
}
function errorResponse(status) {
  return { ok: false, status, text: async () => `errore ${status}` };
}
function timeoutError() {
  const e = new Error('The operation was aborted due to timeout');
  e.name = 'TimeoutError';
  return e;
}

// RESEND_API_KEY deve essere impostata PRIMA del require (letta a runtime ad
// ogni chiamata da attemptSend, non a module-load — a differenza del
// backoff sopra, quindi può essere cambiata per singolo test con
// t.after(() => { delete process.env.RESEND_API_KEY }) invece di un solo
// valore fisso a livello di file).
const { sendEmail, sendTemplatedEmail } = require('./email');

test('RESEND_API_KEY assente -> sent:false, skipped:true, nessuna fetch eseguita', async (t) => {
  delete process.env.RESEND_API_KEY;
  const tracker = installFetchSequence([() => okResponse()]);
  try {
    const result = await sendEmail('cliente@esempio.it', { subject: 'Ciao', html: '<p>Ciao</p>' });
    assert.equal(result.sent, false);
    assert.equal(result.skipped, true);
    assert.equal(tracker.callCount(), 0);
  } finally {
    restoreFetch();
  }
});

test('successo al primo tentativo: nessun retry, from/reply-to/subject/html corretti nel body', async (t) => {
  process.env.RESEND_API_KEY = 'test-key';
  process.env.RESEND_FROM_EMAIL = 'noreply@esempio-agenzia.test';
  process.env.RESEND_REPLY_TO = 'supporto@esempio-agenzia.test';
  let capturedInit;
  globalThis.fetch = async (url, init) => { capturedInit = init; return okResponse(); };
  t.after(() => {
    restoreFetch();
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.RESEND_REPLY_TO;
  });

  const result = await sendEmail('cliente@esempio.it', { subject: 'Benvenuto', html: '<p>Ciao</p>' });
  assert.equal(result.sent, true);

  const body = JSON.parse(capturedInit.body);
  assert.equal(body.from, 'ShardApps <noreply@esempio-agenzia.test>');
  assert.deepEqual(body.to, ['cliente@esempio.it']);
  assert.equal(body.subject, 'Benvenuto');
  assert.equal(body.html, '<p>Ciao</p>');
  assert.deepEqual(body.reply_to, ['supporto@esempio-agenzia.test']);
  assert.equal(capturedInit.headers.Authorization, 'Bearer test-key');
});

test('senza RESEND_REPLY_TO -> nessun campo reply_to nel body (mai undefined esplicito)', async (t) => {
  process.env.RESEND_API_KEY = 'test-key';
  let capturedInit;
  globalThis.fetch = async (url, init) => { capturedInit = init; return okResponse(); };
  t.after(() => { restoreFetch(); delete process.env.RESEND_API_KEY; });

  await sendEmail('cliente@esempio.it', { subject: 'X', html: '<p>X</p>' });
  const body = JSON.parse(capturedInit.body);
  assert.equal('reply_to' in body, false);
});

test('500 -> retry -> successo al secondo tentativo (MAX_EMAIL_RETRIES=1)', async (t) => {
  process.env.RESEND_API_KEY = 'test-key';
  const tracker = installFetchSequence([() => errorResponse(500), () => okResponse()]);
  t.after(() => { restoreFetch(); delete process.env.RESEND_API_KEY; });

  const result = await sendEmail('cliente@esempio.it', { subject: 'X', html: '<p>X</p>' });
  assert.equal(result.sent, true);
  assert.equal(tracker.callCount(), 2);
});

test('timeout -> retry -> successo', async (t) => {
  process.env.RESEND_API_KEY = 'test-key';
  const tracker = installFetchSequence([() => { throw timeoutError(); }, () => okResponse()]);
  t.after(() => { restoreFetch(); delete process.env.RESEND_API_KEY; });

  const result = await sendEmail('cliente@esempio.it', { subject: 'X', html: '<p>X</p>' });
  assert.equal(result.sent, true);
  assert.equal(tracker.callCount(), 2);
});

test('400 -> NESSUN retry (errore permanente, es. indirizzo rifiutato)', async (t) => {
  process.env.RESEND_API_KEY = 'test-key';
  const tracker = installFetchSequence([() => errorResponse(400)]);
  t.after(() => { restoreFetch(); delete process.env.RESEND_API_KEY; });

  const result = await sendEmail('cliente@esempio.it', { subject: 'X', html: '<p>X</p>' });
  assert.equal(result.sent, false);
  assert.equal(tracker.callCount(), 1);
});

test('fallimenti persistenti (503) -> si ferma dopo 1+MAX_EMAIL_RETRIES tentativi, mai un loop', async (t) => {
  process.env.RESEND_API_KEY = 'test-key';
  const tracker = installFetchSequence([() => errorResponse(503)]);
  t.after(() => { restoreFetch(); delete process.env.RESEND_API_KEY; });

  const result = await sendEmail('cliente@esempio.it', { subject: 'X', html: '<p>X</p>' });
  assert.equal(result.sent, false);
  assert.equal(tracker.callCount(), 2); // 1 tentativo iniziale + 1 retry (MAX_EMAIL_RETRIES=1)
});

test('destinatario mancante -> sent:false, nessuna fetch', async () => {
  const tracker = installFetchSequence([() => okResponse()]);
  try {
    const result = await sendEmail('', { subject: 'X', html: '<p>X</p>' });
    assert.equal(result.sent, false);
    assert.equal(tracker.callCount(), 0);
  } finally {
    restoreFetch();
  }
});

// ─── sendTemplatedEmail: compone un template registrato e invia ────────────

test('sendTemplatedEmail: template valido -> subject/html generati dal template arrivano al body della richiesta', async (t) => {
  process.env.RESEND_API_KEY = 'test-key';
  let capturedInit;
  globalThis.fetch = async (url, init) => { capturedInit = init; return okResponse(); };
  t.after(() => { restoreFetch(); delete process.env.RESEND_API_KEY; });

  const result = await sendTemplatedEmail('cliente@esempio.it', 'password_reset', { resetLink: 'https://esempio.it/reset?token=abc' });
  assert.equal(result.sent, true);
  const body = JSON.parse(capturedInit.body);
  assert.equal(body.subject, 'Reimposta la tua password');
  assert.match(body.html, /esempio\.it\/reset\?token=abc/);
});

test('sendTemplatedEmail: nome template sconosciuto -> sent:false, nessuna fetch', async () => {
  const tracker = installFetchSequence([() => okResponse()]);
  try {
    const result = await sendTemplatedEmail('cliente@esempio.it', 'template_inventato', {});
    assert.equal(result.sent, false);
    assert.match(result.error, /sconosciuto/);
    assert.equal(tracker.callCount(), 0);
  } finally {
    restoreFetch();
  }
});
