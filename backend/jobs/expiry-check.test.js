// ─── Test: expiry-check job (Pre-Beta Hardening, Blocco 2) ─────────────────
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeSupabase } = require('../lib/test-helpers/fake-supabase');
const { runExpiryCheckOnce, todayRunKey, defaultSendExpiryWarningEmail, defaultSendBlockedEmail, emailNotificationsEnabled } = require('./expiry-check');

function isoInDays(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

test('app in scadenza entro 5 giorni: invia avviso, segna expiry_warning_sent, mai bloccata', async () => {
  const supabase = makeFakeSupabase({
    apps: [{ id: 'app-1', name: 'App Uno', client_email: 'cliente@esempio.it', expires_at: isoInDays(3), client_active: true, expiry_warning_sent: false }],
  });
  const warned = [];
  const summary = await runExpiryCheckOnce(supabase, {
    sendExpiryWarningEmail: async (app) => { warned.push(app.id); },
    sendBlockedEmail: async () => { throw new Error('non doveva essere chiamata'); },
  });
  assert.deepEqual(warned, ['app-1']);
  assert.equal(summary.warned, 1);
  assert.equal(summary.blocked, 0);
  const { data } = await supabase.from('apps').select('*').eq('id', 'app-1').maybeSingle();
  assert.equal(data.expiry_warning_sent, true);
  assert.equal(data.client_active, true, 'un avviso non blocca l\'app, solo la avvisa');
});

test('app scaduta da più di 5 giorni: blocca (client_active=false) e invia notifica di blocco', async () => {
  const supabase = makeFakeSupabase({
    apps: [{ id: 'app-2', name: 'App Due', client_email: 'cliente2@esempio.it', expires_at: isoInDays(-10), client_active: true, expiry_warning_sent: true }],
  });
  const blocked = [];
  const summary = await runExpiryCheckOnce(supabase, {
    sendExpiryWarningEmail: async () => { throw new Error('non doveva essere chiamata'); },
    sendBlockedEmail: async (app) => { blocked.push(app.id); },
  });
  assert.deepEqual(blocked, ['app-2']);
  assert.equal(summary.blocked, 1);
  const { data } = await supabase.from('apps').select('*').eq('id', 'app-2').maybeSingle();
  assert.equal(data.client_active, false);
});

test('app scaduta da meno di 5 giorni: NON viene ancora bloccata (finestra di grazia)', async () => {
  const supabase = makeFakeSupabase({
    apps: [{ id: 'app-3', name: 'App Tre', client_email: 'c3@esempio.it', expires_at: isoInDays(-2), client_active: true, expiry_warning_sent: true }],
  });
  const summary = await runExpiryCheckOnce(supabase, {
    sendBlockedEmail: async () => { throw new Error('troppo presto per bloccarla'); },
  });
  assert.equal(summary.blocked, 0);
  const { data } = await supabase.from('apps').select('*').eq('id', 'app-3').maybeSingle();
  assert.equal(data.client_active, true);
});

test('app senza client_email: aggiornata comunque, nessun invio email tentato', async () => {
  const supabase = makeFakeSupabase({
    apps: [{ id: 'app-4', name: 'App Quattro', client_email: null, expires_at: isoInDays(2), client_active: true, expiry_warning_sent: false }],
  });
  let emailCalled = false;
  const summary = await runExpiryCheckOnce(supabase, {
    sendExpiryWarningEmail: async () => { emailCalled = true; },
  });
  assert.equal(emailCalled, false);
  assert.equal(summary.warned, 1);
});

test('app già segnalata (expiry_warning_sent=true) non viene segnalata di nuovo', async () => {
  const supabase = makeFakeSupabase({
    apps: [{ id: 'app-5', name: 'App Cinque', client_email: 'c5@esempio.it', expires_at: isoInDays(2), client_active: true, expiry_warning_sent: true }],
  });
  const summary = await runExpiryCheckOnce(supabase, {
    sendExpiryWarningEmail: async () => { throw new Error('già avvisata, non deve ripartire'); },
  });
  assert.equal(summary.warned, 0);
});

test('app inattiva (client_active=false) non viene toccata da nessuna delle due sezioni', async () => {
  const supabase = makeFakeSupabase({
    apps: [{ id: 'app-6', name: 'App Sei', client_email: 'c6@esempio.it', expires_at: isoInDays(-30), client_active: false, expiry_warning_sent: false }],
  });
  const summary = await runExpiryCheckOnce(supabase, {
    sendExpiryWarningEmail: async () => { throw new Error('non doveva partire'); },
    sendBlockedEmail: async () => { throw new Error('non doveva partire'); },
  });
  assert.equal(summary.warned, 0);
  assert.equal(summary.blocked, 0);
});

test('un invio email fallito per una app non blocca le altre app del batch', async () => {
  const supabase = makeFakeSupabase({
    apps: [
      { id: 'app-7', name: 'A', client_email: 'a@esempio.it', expires_at: isoInDays(1), client_active: true, expiry_warning_sent: false },
      { id: 'app-8', name: 'B', client_email: 'b@esempio.it', expires_at: isoInDays(1), client_active: true, expiry_warning_sent: false },
    ],
  });
  const warned = [];
  const summary = await runExpiryCheckOnce(supabase, {
    sendExpiryWarningEmail: async (app) => {
      if (app.id === 'app-7') throw new Error('provider email giù');
      warned.push(app.id);
    },
  });
  assert.deepEqual(warned, ['app-8'], 'app-8 processata anche se app-7 è fallita');
  assert.equal(summary.warned, 1);
  assert.equal(summary.errors.length, 1);
});

test('todayRunKey: formato YYYY-MM-DD, stabile per l\'intera giornata', () => {
  const key = todayRunKey();
  assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
});

// ─── emailNotificationsEnabled / defaultSend*Email (Notifications Round 2) ──
// RESEND_API_KEY assente in questo ambiente di test: defaultSend*Email arriva
// fino al tentativo di invio (via lib/email.js) e si ferma lì (skipped) senza
// mai lanciare — stesso comportamento reale di un ambiente senza il
// provider configurato, nessun mock di rete necessario per questi test.

test('emailNotificationsEnabled: preferenza assente/malformata -> true (fail-open)', () => {
  assert.equal(emailNotificationsEnabled({}), true);
  assert.equal(emailNotificationsEnabled({ notification_preferences: null }), true);
  assert.equal(emailNotificationsEnabled({ notification_preferences: 'non-un-oggetto' }), true);
  assert.equal(emailNotificationsEnabled({ notification_preferences: {} }), true);
});
test('emailNotificationsEnabled: email:false esplicito -> false', () => {
  assert.equal(emailNotificationsEnabled({ notification_preferences: { email: false } }), false);
});
test('emailNotificationsEnabled: email:true esplicito -> true', () => {
  assert.equal(emailNotificationsEnabled({ notification_preferences: { email: true } }), true);
});

test('defaultSendExpiryWarningEmail: preferenze email disattivate -> non lancia, non tenta nulla oltre il log', async () => {
  const app = { id: 'app-9', name: 'App Nove', client_email: 'c9@esempio.it', expires_at: isoInDays(2), slug: 'app-nove', notification_preferences: { email: false } };
  await defaultSendExpiryWarningEmail(app); // non deve lanciare
});

test('defaultSendExpiryWarningEmail: preferenze abilitate (default) -> non lancia (RESEND_API_KEY assente in test -> skip silenzioso)', async () => {
  const app = { id: 'app-10', name: 'App Dieci', client_email: 'c10@esempio.it', expires_at: isoInDays(2), slug: 'app-dieci' };
  await defaultSendExpiryWarningEmail(app); // non deve lanciare
});

test('defaultSendBlockedEmail: preferenze email disattivate -> non lancia', async () => {
  const app = { id: 'app-11', name: 'App Undici', client_email: 'c11@esempio.it', slug: 'app-undici', notification_preferences: { email: false } };
  await defaultSendBlockedEmail(app); // non deve lanciare
});

test('defaultSendBlockedEmail: preferenze abilitate -> non lancia', async () => {
  const app = { id: 'app-12', name: 'App Dodici', client_email: 'c12@esempio.it', slug: 'app-dodici' };
  await defaultSendBlockedEmail(app); // non deve lanciare
});
