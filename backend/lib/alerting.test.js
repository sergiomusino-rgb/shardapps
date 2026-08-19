// ─── Test: alerting minimo (Pre-Beta Hardening, Blocco 7) ──────────────────
// Nessuna chiamata di rete reale in nessun caso: sendEmail/sendWebhook sono
// sempre le implementazioni di default SOLO quando i canali risultano
// "configurati" per via delle env var — questo file non imposta MAI
// RESEND_API_KEY/ALERT_EMAIL_TO/ALERT_WEBHOOK_URL reali, quindi
// isEmailConfigured()/isWebhookConfigured() sono sempre false per i default,
// e ogni test che vuole verificare l'invio passa un sendEmail/sendWebhook
// finto via `deps` — mai il default reale.
'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Import fresco ad ogni richiesta di questo file: non serve, il modulo legge
// le env var a CHIAMATA (isEmailConfigured/isWebhookConfigured), non a
// module-load, quindi possiamo mutare process.env tra un test e l'altro.
const { maybeSendAlert, shouldSend, isEmailConfigured, isWebhookConfigured, __resetAlertDedupForTests } = require('./alerting');

beforeEach(() => {
  __resetAlertDedupForTests();
  delete process.env.ALERT_EMAIL_TO;
  delete process.env.ALERT_WEBHOOK_URL;
});

test('non configurato (nessuna env var) -> isEmailConfigured/isWebhookConfigured false', () => {
  assert.equal(isEmailConfigured(), false);
  assert.equal(isWebhookConfigured(), false);
});

test('maybeSendAlert: nessun canale configurato -> no-op silenzioso, nessuna funzione di invio chiamata', async () => {
  let called = false;
  await maybeSendAlert(
    { route: 'test.route', message: 'boom' },
    { sendEmail: async () => { called = true; }, sendWebhook: async () => { called = true; } }
  );
  assert.equal(called, false);
});

test('maybeSendAlert: webhook configurato -> sendWebhook chiamato con il testo formattato', async () => {
  process.env.ALERT_WEBHOOK_URL = 'https://example.invalid/webhook';
  const calls = [];
  await maybeSendAlert(
    { route: 'creator.publish', message: 'errore pubblicazione' },
    { sendWebhook: async (entry) => { calls.push(entry); } }
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].route, 'creator.publish');
});

test('maybeSendAlert: dedup — due alert per la stessa route entro la finestra -> solo il primo viene inviato', async () => {
  process.env.ALERT_WEBHOOK_URL = 'https://example.invalid/webhook';
  let sendCount = 0;
  let t = 1000;
  const deps = { sendWebhook: async () => { sendCount += 1; }, now: () => t };

  await maybeSendAlert({ route: 'same.route', message: 'primo' }, deps);
  t += 1000; // 1s dopo, ben dentro la finestra di dedup (default 15 min)
  await maybeSendAlert({ route: 'same.route', message: 'secondo' }, deps);

  assert.equal(sendCount, 1, 'il secondo alert per la stessa route è stato soppresso (dedup)');
});

test('maybeSendAlert: route diverse non si deduplicano a vicenda', async () => {
  process.env.ALERT_WEBHOOK_URL = 'https://example.invalid/webhook';
  let sendCount = 0;
  const deps = { sendWebhook: async () => { sendCount += 1; } };

  await maybeSendAlert({ route: 'route.a', message: 'x' }, deps);
  await maybeSendAlert({ route: 'route.b', message: 'y' }, deps);

  assert.equal(sendCount, 2);
});

test('maybeSendAlert: dopo la finestra di dedup, un nuovo alert per la stessa route viene reinviato', async () => {
  process.env.ALERT_WEBHOOK_URL = 'https://example.invalid/webhook';
  let sendCount = 0;
  let t = 0;
  const deps = { sendWebhook: async () => { sendCount += 1; }, now: () => t };

  await maybeSendAlert({ route: 'r' }, deps);
  t += 16 * 60 * 1000; // 16 minuti dopo, oltre la finestra di 15
  await maybeSendAlert({ route: 'r' }, deps);

  assert.equal(sendCount, 2);
});

test('maybeSendAlert: un errore di invio (email o webhook) non lancia mai', async () => {
  process.env.ALERT_WEBHOOK_URL = 'https://example.invalid/webhook';
  await assert.doesNotReject(() => maybeSendAlert(
    { route: 'x', message: 'boom' },
    { sendWebhook: async () => { throw new Error('rete giù'); } }
  ));
});

test('shouldSend: coerente con maybeSendAlert (stessa logica di dedup esposta a parte)', () => {
  const t = 5000;
  assert.equal(shouldSend('r1', t), true, 'prima chiamata per questa route -> invia');
  assert.equal(shouldSend('r1', t + 1000), false, 'entro la finestra -> non invia');
  assert.equal(shouldSend('r1', t + 20 * 60 * 1000), true, 'oltre la finestra -> invia di nuovo');
});
