// ─── Test dell'SSRF guard (Security Audit Fase 4 — fix BLOCKER) ────────────
// Copre isPrivateOrReservedIp/isObviouslyLocalHostname (logica pura, nessuna
// dipendenza esterna) e validateWebhookUrl con dns.promises.lookup mockato
// via node:test (t.mock.method) — mai una vera risoluzione DNS in un test
// automatico: renderebbe la suite lenta, flaky in CI (dipendente dalla rete/
// dal resolver dell'ambiente) e capace di rompersi se un dominio pubblico
// usato come fixture cambia risoluzione in futuro. Il comportamento di rete
// reale (fetch bloccata su un endpoint privato vero, redirect/timeout) resta
// verificato manualmente prima del deploy — qui l'obiettivo è avere una rete
// di sicurezza automatica sulla logica di decisione (denylist IPv4/IPv6,
// fail-closed), che prima non esisteva (vedi audit "P1 — zero test
// automatici sul core SaaS Factory").
//
// Uso: node --test lib (dalla cartella backend/), o npm test.

const test = require('node:test');
const assert = require('node:assert/strict');
const dns = require('node:dns');

const {
  isPrivateOrReservedIp,
  isObviouslyLocalHostname,
  validateWebhookUrl,
} = require('./ssrf-guard');

// ─── isPrivateOrReservedIp — IPv4 ────────────────────────────────────────

test('isPrivateOrReservedIp: 127.0.0.1 (loopback) -> true', () => {
  assert.equal(isPrivateOrReservedIp('127.0.0.1'), true);
});

test('isPrivateOrReservedIp: 169.254.169.254 (metadata cloud AWS/GCP/Azure) -> true', () => {
  assert.equal(isPrivateOrReservedIp('169.254.169.254'), true);
});

test('isPrivateOrReservedIp: 10.0.0.1 (RFC1918) -> true', () => {
  assert.equal(isPrivateOrReservedIp('10.0.0.1'), true);
});

test('isPrivateOrReservedIp: 172.16.0.1 (RFC1918) -> true', () => {
  assert.equal(isPrivateOrReservedIp('172.16.0.1'), true);
});

test('isPrivateOrReservedIp: 192.168.1.1 (RFC1918) -> true', () => {
  assert.equal(isPrivateOrReservedIp('192.168.1.1'), true);
});

test('isPrivateOrReservedIp: 100.64.0.1 (Carrier-Grade NAT, RFC6598) -> true', () => {
  assert.equal(isPrivateOrReservedIp('100.64.0.1'), true);
});

test('isPrivateOrReservedIp: 0.0.0.0 (unspecified) -> true', () => {
  assert.equal(isPrivateOrReservedIp('0.0.0.0'), true);
});

test('isPrivateOrReservedIp: 255.255.255.255 (broadcast) -> true', () => {
  assert.equal(isPrivateOrReservedIp('255.255.255.255'), true);
});

test('isPrivateOrReservedIp: 224.0.0.1 (multicast) -> true', () => {
  assert.equal(isPrivateOrReservedIp('224.0.0.1'), true);
});

test('isPrivateOrReservedIp: 192.0.2.1 (documentazione, TEST-NET-1) -> true', () => {
  assert.equal(isPrivateOrReservedIp('192.0.2.1'), true);
});

test('isPrivateOrReservedIp: 8.8.8.8 (pubblico, Google DNS) -> false', () => {
  assert.equal(isPrivateOrReservedIp('8.8.8.8'), false);
});

test('isPrivateOrReservedIp: 1.1.1.1 (pubblico, Cloudflare DNS) -> false', () => {
  assert.equal(isPrivateOrReservedIp('1.1.1.1'), false);
});

test('isPrivateOrReservedIp: indirizzo IPv4 al bordo di un range privato (10.255.255.255) -> true', () => {
  assert.equal(isPrivateOrReservedIp('10.255.255.255'), true);
});

test('isPrivateOrReservedIp: indirizzo IPv4 appena fuori da 10.0.0.0/8 (11.0.0.1) -> false', () => {
  assert.equal(isPrivateOrReservedIp('11.0.0.1'), false);
});

// ─── isPrivateOrReservedIp — IPv6 ────────────────────────────────────────

test('isPrivateOrReservedIp: ::1 (loopback IPv6) -> true', () => {
  assert.equal(isPrivateOrReservedIp('::1'), true);
});

test('isPrivateOrReservedIp: :: (unspecified IPv6) -> true', () => {
  assert.equal(isPrivateOrReservedIp('::'), true);
});

test('isPrivateOrReservedIp: fc00::1 (unique-local RFC4193) -> true', () => {
  assert.equal(isPrivateOrReservedIp('fc00::1'), true);
});

test('isPrivateOrReservedIp: fd12:3456::1 (unique-local, prefisso fd) -> true', () => {
  assert.equal(isPrivateOrReservedIp('fd12:3456::1'), true);
});

test('isPrivateOrReservedIp: fe80::1 (link-local IPv6) -> true', () => {
  assert.equal(isPrivateOrReservedIp('fe80::1'), true);
});

test('isPrivateOrReservedIp: 2606:4700:4700::1111 (pubblico, Cloudflare) -> false', () => {
  assert.equal(isPrivateOrReservedIp('2606:4700:4700::1111'), false);
});

test('isPrivateOrReservedIp: ::ffff:127.0.0.1 (IPv4-mapped su loopback) -> true', () => {
  // La minaccia reale è l'IPv4 incapsulato: un attaccante potrebbe provare a
  // aggirare la denylist IPv4 chiedendo la forma IPv6-mapped dello stesso
  // indirizzo privato.
  assert.equal(isPrivateOrReservedIp('::ffff:127.0.0.1'), true);
});

test('isPrivateOrReservedIp: ::ffff:8.8.8.8 (IPv4-mapped su indirizzo pubblico) -> false', () => {
  assert.equal(isPrivateOrReservedIp('::ffff:8.8.8.8'), false);
});

// ─── isPrivateOrReservedIp — fail-closed ─────────────────────────────────

test('isPrivateOrReservedIp: stringa vuota -> true (fail-closed, nessun indirizzo = non sicuro)', () => {
  assert.equal(isPrivateOrReservedIp(''), true);
});

test('isPrivateOrReservedIp: null -> true (fail-closed)', () => {
  assert.equal(isPrivateOrReservedIp(null), true);
});

// ─── isObviouslyLocalHostname ────────────────────────────────────────────

test('isObviouslyLocalHostname: "localhost" -> true', () => {
  assert.equal(isObviouslyLocalHostname('localhost'), true);
});

test('isObviouslyLocalHostname: "LOCALHOST" (maiuscolo) -> true', () => {
  assert.equal(isObviouslyLocalHostname('LOCALHOST'), true);
});

test('isObviouslyLocalHostname: "app.localhost" -> true', () => {
  assert.equal(isObviouslyLocalHostname('app.localhost'), true);
});

test('isObviouslyLocalHostname: "printer.local" (mDNS) -> true', () => {
  assert.equal(isObviouslyLocalHostname('printer.local'), true);
});

test('isObviouslyLocalHostname: "service.internal" -> true', () => {
  assert.equal(isObviouslyLocalHostname('service.internal'), true);
});

test('isObviouslyLocalHostname: "webhook.site" (dominio pubblico legittimo) -> false', () => {
  assert.equal(isObviouslyLocalHostname('webhook.site'), false);
});

test('isObviouslyLocalHostname: "example.com" -> false', () => {
  assert.equal(isObviouslyLocalHostname('example.com'), false);
});

// ─── validateWebhookUrl ──────────────────────────────────────────────────
// dns.promises.lookup mockato per test: nessuna vera risoluzione DNS.

test('validateWebhookUrl: URL non parsabile -> safe:false', async () => {
  const result = await validateWebhookUrl('non-e-un-url');
  assert.equal(result.safe, false);
  assert.match(result.reason, /URL non valido/);
});

test('validateWebhookUrl: protocollo non http(s) (es. ftp) -> safe:false', async () => {
  const result = await validateWebhookUrl('ftp://example.com/file');
  assert.equal(result.safe, false);
  assert.match(result.reason, /Protocollo non ammesso/);
});

test('validateWebhookUrl: protocollo non http(s) (file://, accesso al filesystem locale) -> safe:false', async (t) => {
  const lookupMock = t.mock.method(dns.promises, 'lookup', async () => {
    throw new Error('dns.lookup non doveva essere chiamato per uno schema non-http(s)');
  });
  const result = await validateWebhookUrl('file:///etc/passwd');
  assert.equal(result.safe, false);
  assert.match(result.reason, /Protocollo non ammesso/);
  assert.equal(lookupMock.mock.callCount(), 0);
});

test('validateWebhookUrl: protocollo javascript: -> safe:false, mai raggiunge la risoluzione DNS', async (t) => {
  const lookupMock = t.mock.method(dns.promises, 'lookup', async () => {
    throw new Error('dns.lookup non doveva essere chiamato per uno schema non-http(s)');
  });
  const result = await validateWebhookUrl('javascript:alert(1)');
  assert.equal(result.safe, false);
  assert.equal(lookupMock.mock.callCount(), 0);
});

test('validateWebhookUrl: hostname "localhost" -> safe:false SENZA chiamare dns.lookup (short-circuit)', async (t) => {
  const lookupMock = t.mock.method(dns.promises, 'lookup', async () => {
    throw new Error('dns.lookup non doveva essere chiamato per un hostname ovviamente locale');
  });
  const result = await validateWebhookUrl('http://localhost/webhook');
  assert.equal(result.safe, false);
  assert.match(result.reason, /Hostname locale non ammesso/);
  assert.equal(lookupMock.mock.callCount(), 0);
});

test('validateWebhookUrl: hostname pubblico che risolve a un solo indirizzo pubblico -> safe:true', async (t) => {
  t.mock.method(dns.promises, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
  const result = await validateWebhookUrl('https://api.example-webhooks.com/hook');
  assert.equal(result.safe, true);
  assert.deepEqual(result.addresses, ['8.8.8.8']);
});

test('validateWebhookUrl: hostname che risolve SOLO a un indirizzo privato -> safe:false', async (t) => {
  t.mock.method(dns.promises, 'lookup', async () => [{ address: '10.0.0.5', family: 4 }]);
  const result = await validateWebhookUrl('https://interno.esempio.local-dns.test/hook');
  assert.equal(result.safe, false);
  assert.match(result.reason, /indirizzo privato\/riservato/);
});

test('validateWebhookUrl: DNS rebinding / multi-IP — un indirizzo pubblico E uno privato -> safe:false (blocca su QUALSIASI indirizzo pericoloso, non solo il primo)', async (t) => {
  // Il caso che giustifica dns.lookup(..., {all:true}) invece del solo
  // risultato "principale": un hostname con più A record, uno di facciata
  // pubblico e uno privato — bloccare solo guardando il primo risultato
  // lascerebbe passare l'SSRF se l'ordine dei record cambia.
  t.mock.method(dns.promises, 'lookup', async () => [
    { address: '8.8.4.4', family: 4 },
    { address: '169.254.169.254', family: 4 },
  ]);
  const result = await validateWebhookUrl('https://multi-homed.esempio.test/hook');
  assert.equal(result.safe, false);
  assert.match(result.reason, /169\.254\.169\.254/);
});

test('validateWebhookUrl: risoluzione DNS fallita (ENOTFOUND) -> safe:false (fail-closed)', async (t) => {
  t.mock.method(dns.promises, 'lookup', async () => {
    const err = new Error('getaddrinfo ENOTFOUND dominio-inesistente.test');
    err.code = 'ENOTFOUND';
    throw err;
  });
  const result = await validateWebhookUrl('https://dominio-inesistente.test/hook');
  assert.equal(result.safe, false);
  assert.match(result.reason, /Risoluzione DNS fallita/);
});

test('validateWebhookUrl: dns.lookup risolve un array vuoto -> safe:false', async (t) => {
  t.mock.method(dns.promises, 'lookup', async () => []);
  const result = await validateWebhookUrl('https://nessun-indirizzo.esempio.test/hook');
  assert.equal(result.safe, false);
  assert.match(result.reason, /Nessun indirizzo risolto/);
});

// NB: il ramo "Hostname mancante" (validateWebhookUrl, `if (!hostname)`) è
// codice difensivo non raggiungibile per un http(s) URL: il parser WHATWG
// URL lancia già "Invalid URL" (catturato dal ramo "URL non valido" sopra)
// per qualunque stringa che produrrebbe un hostname vuoto con questi schemi
// (verificato: `new URL('http://')`/`http:///` lanciano entrambi, non
// restituiscono un hostname vuoto) — nessun input costruibile lo eserciterebbe
// davvero, quindi non simulato qui con un caso finto.

test('validateWebhookUrl: IPv4 letterale privato nell\'URL (senza passare da un hostname) -> safe:false', async (t) => {
  // Anche un IP letterale passa comunque da dns.promises.lookup (che per un
  // IP letterale lo restituisce identico, senza query di rete reale) — il
  // guard non deve fidarsi solo del check "ovvio" sincrono già fatto lato
  // frontend (site-schema.ts), qui è la barriera autoritativa.
  t.mock.method(dns.promises, 'lookup', async () => [{ address: '127.0.0.1', family: 4 }]);
  const result = await validateWebhookUrl('http://127.0.0.1/webhook');
  assert.equal(result.safe, false);
});
