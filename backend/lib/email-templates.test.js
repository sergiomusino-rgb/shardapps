// ─── Test: lib/email-templates.js (Notifications Round 2) ──────────────────
// Modulo puro, nessun I/O: verifica solo la forma {subject, html} e che i
// dati passati finiscano davvero nel markup (link di reset, messaggio,
// nome app), oltre alla difesa base contro HTML injection nei campi
// interpolati (escapeHtml).
'use strict';

const test = require('node:test');
const { describe } = require('node:test');
const assert = require('node:assert/strict');

const { EMAIL_TEMPLATES } = require('./email-templates');

describe('password_reset', () => {
  test('include il link di reset e scade in 15 minuti (testo fisso)', () => {
    const { subject, html } = EMAIL_TEMPLATES.password_reset({ resetLink: 'https://x.test/reset?token=abc123' });
    assert.equal(subject, 'Reimposta la tua password');
    assert.match(html, /https:\/\/x\.test\/reset\?token=abc123/);
    assert.match(html, /15 minuti/);
  });
  test('appName presente -> citato nel corpo', () => {
    const { html } = EMAIL_TEMPLATES.password_reset({ resetLink: 'https://x.test', appName: 'Gestionale Rossi' });
    assert.match(html, /Gestionale Rossi/);
  });
});

describe('workflow_notification', () => {
  test('subject/message custom mantenuti', () => {
    const { subject, html } = EMAIL_TEMPLATES.workflow_notification({ subject: 'Nuovo ordine', message: 'Hai ricevuto un nuovo ordine.' });
    assert.equal(subject, 'Nuovo ordine');
    assert.match(html, /Hai ricevuto un nuovo ordine\./);
  });
  test('subject assente -> fallback "Notifica da <appName>"', () => {
    const { subject } = EMAIL_TEMPLATES.workflow_notification({ appName: 'Gestionale Rossi' });
    assert.equal(subject, 'Notifica da Gestionale Rossi');
  });
});

describe('provisioning', () => {
  test('include nome app e link di accesso', () => {
    const { subject, html } = EMAIL_TEMPLATES.provisioning({ appName: 'Gestionale Rossi', accessUrl: 'https://x.test/a/rossi' });
    assert.match(subject, /Gestionale Rossi/);
    assert.match(html, /https:\/\/x\.test\/a\/rossi/);
  });
});

describe('billing', () => {
  test('bodyHtml passato invariato, CTA presente solo se ctaUrl fornito', () => {
    const withCta = EMAIL_TEMPLATES.billing({ title: 'Abbonamento in scadenza', bodyHtml: '<p>dettagli</p>', ctaUrl: 'https://x.test/paga', ctaLabel: 'Rinnova' });
    assert.match(withCta.html, /dettagli/);
    assert.match(withCta.html, /Rinnova/);
    assert.match(withCta.html, /https:\/\/x\.test\/paga/);

    const withoutCta = EMAIL_TEMPLATES.billing({ title: 'Solo avviso', bodyHtml: '<p>solo testo</p>' });
    assert.doesNotMatch(withoutCta.html, /href=/);
  });
});

describe('admin_alert', () => {
  test('title/message riportati, nessun branding tenant (mittente sempre ShardApps)', () => {
    const { subject, html } = EMAIL_TEMPLATES.admin_alert({ title: 'App presa in gestione', message: 'Il tuo servizio è ora gestito da ShardApps.' });
    assert.equal(subject, 'App presa in gestione');
    assert.match(html, /gestito da ShardApps/);
  });
});

describe('escapeHtml — mai un injection HTML dai dati interpolati', () => {
  test('un messaggio con markup HTML viene neutralizzato nel corpo', () => {
    const { html } = EMAIL_TEMPLATES.workflow_notification({ subject: 'X', message: '<img src=x onerror=alert(1)>' });
    assert.equal(html.includes('<img src=x onerror=alert(1)>'), false);
    assert.match(html, /&lt;img/);
  });
  test('un appName con markup HTML viene neutralizzato nel titolo/corpo', () => {
    const { html } = EMAIL_TEMPLATES.password_reset({ resetLink: 'https://x.test', appName: '<script>alert(1)</script>' });
    assert.equal(html.includes('<script>alert(1)</script>'), false);
  });
});

describe('branding — appName sostituisce l\'etichetta generica in calce', () => {
  test('senza branding -> "ShardApps" in calce', () => {
    const { html } = EMAIL_TEMPLATES.workflow_notification({ message: 'x' });
    assert.match(html, /— ShardApps\s*<\/p>/);
  });
  test('con branding.appName -> "<appName> via ShardApps" in calce', () => {
    const { html } = EMAIL_TEMPLATES.workflow_notification({ message: 'x', branding: { appName: 'Gestionale Rossi' } });
    assert.match(html, /Gestionale Rossi via ShardApps/);
  });
});
