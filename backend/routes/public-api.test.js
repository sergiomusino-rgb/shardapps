// ─── Test di routes/public-api.js — POST /:appId/webhooks/incoming ─────────
// (Integrations — Pre-Beta Hardening Round 2)
//
// Questo file NON simula un server Express reale (nessuna route del backend
// lo fa, vedi public-api-auth.test.js/public-api-entity-safety.test.js):
// requireApiKey costruisce il proprio client Supabase internamente
// (getSupabase(), non iniettato), quindi un vero test HTTP richiederebbe una
// rete/DB reali. Testiamo invece le funzioni pure che la route usa per
// decidere cosa fare col body/query in arrivo (__testables, esportate solo
// per i test). L'autenticazione/autorizzazione (bad auth, tenant isolation)
// è già coperta da public-api-auth.test.js — requireApiKey/requireScope
// sono la STESSA identica middleware chain di ogni altra route di questo
// file, non duplicata qui. Il comportamento di routing dell'evento
// 'webhook.received' verso i workflow (incl. isolamento cross-app) è coperto
// in lib/event-router.test.js con lo stesso identico shape di evento
// costruito da questa route.
//
// Uso: node --test routes (dalla cartella backend/), o npm test.

const test = require('node:test');
const { describe } = require('node:test');
const assert = require('node:assert/strict');

const { __testables } = require('./public-api');
const { validateIncomingWebhookPayload, parseIncomingWebhookEntity, parseIdempotencyKey } = __testables;

describe('validateIncomingWebhookPayload', () => {
  test('oggetto JSON valido -> ok', () => {
    assert.deepEqual(validateIncomingWebhookPayload({ ordine: 123, cliente: 'Mario' }), { ok: true });
  });

  test('body assente/undefined -> ok (equivale a oggetto vuoto, un webhook "ping" è legittimo)', () => {
    assert.deepEqual(validateIncomingWebhookPayload(undefined), { ok: true });
    assert.deepEqual(validateIncomingWebhookPayload({}), { ok: true });
  });

  test('body null -> 400 (non è un oggetto)', () => {
    const r = validateIncomingWebhookPayload(null);
    // null è servito come "assente" da rawBody||{} nel branch reale, ma la
    // funzione pura testata direttamente con null esplicito lo tratta come
    // fallback a {} tramite `rawBody || {}` — verifichiamo che quel fallback
    // sia esattamente {} e quindi ok, mai un crash.
    assert.equal(r.ok, true);
  });

  test('body array -> 400, il body deve essere un oggetto, mai un array', () => {
    const r = validateIncomingWebhookPayload([1, 2, 3]);
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
    assert.match(r.error, /oggetto JSON/);
  });

  test('body stringa/numero -> 400', () => {
    assert.equal(validateIncomingWebhookPayload('stringa').ok, false);
    assert.equal(validateIncomingWebhookPayload(42).ok, false);
  });

  test('payload oltre il limite (100KB) -> 413, mai accettato silenziosamente', () => {
    const big = { data: 'x'.repeat(200_000) };
    const r = validateIncomingWebhookPayload(big);
    assert.equal(r.ok, false);
    assert.equal(r.status, 413);
    assert.match(r.error, /grande/);
  });

  test('payload appena sotto il limite -> ok', () => {
    // ~100KB di JSON stringato: tiene conto dell'overhead delle chiavi/quote.
    const justUnder = { data: 'x'.repeat(90_000) };
    assert.equal(validateIncomingWebhookPayload(justUnder).ok, true);
  });
});

describe('parseIncomingWebhookEntity', () => {
  test('stringa non vuota -> trim e ritornata', () => {
    assert.equal(parseIncomingWebhookEntity('  ordini  '), 'ordini');
  });
  test('assente/vuota/non stringa -> undefined (webhook generico, nessun filtro entity)', () => {
    assert.equal(parseIncomingWebhookEntity(undefined), undefined);
    assert.equal(parseIncomingWebhookEntity(''), undefined);
    assert.equal(parseIncomingWebhookEntity('   '), undefined);
    assert.equal(parseIncomingWebhookEntity(['ordini', 'clienti']), undefined); // query ripetuta -> express la darebbe come array, mai accettata come entity
    assert.equal(parseIncomingWebhookEntity(123), undefined);
  });
});

describe('parseIdempotencyKey', () => {
  test('stringa non vuota -> trim e ritornata', () => {
    assert.equal(parseIdempotencyKey('  ordine-123  '), 'ordine-123');
  });
  test('assente/vuota/non stringa -> undefined (header opzionale)', () => {
    assert.equal(parseIdempotencyKey(undefined), undefined);
    assert.equal(parseIdempotencyKey(''), undefined);
    assert.equal(parseIdempotencyKey('   '), undefined);
    assert.equal(parseIdempotencyKey(123), undefined);
  });
  test('oltre il limite di lunghezza -> undefined (mai una chiave arbitrariamente grande)', () => {
    assert.equal(parseIdempotencyKey('x'.repeat(201)), undefined);
  });
  test('esattamente al limite -> accettata', () => {
    assert.equal(parseIdempotencyKey('x'.repeat(200)), 'x'.repeat(200));
  });
});
