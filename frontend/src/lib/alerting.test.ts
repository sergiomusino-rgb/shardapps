// ─── Test: alerting minimo (Pre-Beta Hardening, Blocco 7) ──────────────────
// Stessa garanzia della controparte backend: nessuna chiamata di rete reale,
// mai imposta ALERT_EMAIL_TO/ALERT_WEBHOOK_URL/RESEND_API_KEY reali, ogni
// test che vuole verificare l'invio passa un sendEmail/sendWebhook finto.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { maybeSendAlert, shouldSend, isEmailConfigured, isWebhookConfigured, __resetAlertDedupForTests } from './alerting.ts';

beforeEach(() => {
  __resetAlertDedupForTests();
  delete process.env.ALERT_EMAIL_TO;
  delete process.env.ALERT_WEBHOOK_URL;
});

test('non configurato -> isEmailConfigured/isWebhookConfigured false', () => {
  assert.equal(isEmailConfigured(), false);
  assert.equal(isWebhookConfigured(), false);
});

test('maybeSendAlert: nessun canale configurato -> no-op, nessuna funzione di invio chiamata', async () => {
  let called = false;
  await maybeSendAlert(
    { route: 'test.route', message: 'boom' },
    { sendEmail: async () => { called = true; }, sendWebhook: async () => { called = true; } }
  );
  assert.equal(called, false);
});

test('maybeSendAlert: webhook configurato -> sendWebhook chiamato', async () => {
  process.env.ALERT_WEBHOOK_URL = 'https://example.invalid/webhook';
  const calls: unknown[] = [];
  await maybeSendAlert(
    { route: 'creator.publish', message: 'errore pubblicazione' },
    { sendWebhook: async (entry) => { calls.push(entry); } }
  );
  assert.equal(calls.length, 1);
});

test('maybeSendAlert: dedup — due alert per la stessa route entro la finestra -> solo il primo viene inviato', async () => {
  process.env.ALERT_WEBHOOK_URL = 'https://example.invalid/webhook';
  let sendCount = 0;
  let t = 1000;
  const deps = { sendWebhook: async () => { sendCount += 1; }, now: () => t };

  await maybeSendAlert({ route: 'same.route', message: 'primo' }, deps);
  t += 1000;
  await maybeSendAlert({ route: 'same.route', message: 'secondo' }, deps);

  assert.equal(sendCount, 1);
});

test('maybeSendAlert: un errore di invio non lancia mai', async () => {
  process.env.ALERT_WEBHOOK_URL = 'https://example.invalid/webhook';
  await assert.doesNotReject(() => maybeSendAlert(
    { route: 'x', message: 'boom' },
    { sendWebhook: async () => { throw new Error('rete giù'); } }
  ));
});

test('shouldSend: coerente con maybeSendAlert', () => {
  const t = 5000;
  assert.equal(shouldSend('r1', t), true);
  assert.equal(shouldSend('r1', t + 1000), false);
  assert.equal(shouldSend('r1', t + 20 * 60 * 1000), true);
});
