// ─── SSRF Guard (Security Audit Fase 4 — fix BLOCKER) ──────────────────────
// Unico punto di verità per decidere se un URL fornito da un tenant
// (adminPanel.entities[].actions[].webhookUrl) è sicuro da chiamare dal
// backend. Usato da action-dispatcher.js prima di ogni fetch verso un
// webhook. Il check "ovvio" senza DNS in frontend/src/lib/site-schema.ts
// (sanitizeSiteBlueprint) è solo una prima linea di difesa allo storage:
// QUESTO modulo, con risoluzione DNS reale, è l'unica barriera autoritativa
// — un dominio pubblico può comunque risolvere verso un IP privato (DNS
// rebinding, redirect, semplice A record interno), e solo qui lo vediamo.
//
// Fail-closed per design: qualunque ambiguità (URL non parsabile, DNS non
// risolvibile, hostname vuoto) blocca la richiesta invece di lasciarla
// passare — un webhook "non consegnato per errore" è un fastidio recuperabile
// per il tenant, una SSRF riuscita non lo è.

const dns = require('node:dns');

function ipv4ToLong(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
}

function ipv4InCidr(ip, cidr) {
  const [range, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);
  const ipLong = ipv4ToLong(ip);
  const rangeLong = ipv4ToLong(range);
  if (ipLong === null || rangeLong === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipLong & mask) === (rangeLong & mask);
}

// Denylist IPv4: i range esplicitamente richiesti dall'audit (loopback,
// privati RFC1918, link-local/metadata cloud) più alcuni range riservati
// standard (CGNAT, documentazione, multicast/riservato/broadcast) — stessa
// famiglia di rischio, costano zero falsi positivi su webhook pubblici reali.
const IPV4_DENYLIST = [
  '0.0.0.0/8',        // "questa" rete / unspecified
  '127.0.0.0/8',       // loopback
  '10.0.0.0/8',         // privato RFC1918
  '172.16.0.0/12',      // privato RFC1918
  '192.168.0.0/16',     // privato RFC1918
  '169.254.0.0/16',     // link-local, include il metadata cloud 169.254.169.254
  '100.64.0.0/10',      // Carrier-Grade NAT (RFC6598)
  '192.0.0.0/24',       // IETF protocol assignments
  '192.0.2.0/24',       // documentazione (TEST-NET-1)
  '198.18.0.0/15',      // benchmarking
  '198.51.100.0/24',    // documentazione (TEST-NET-2)
  '203.0.113.0/24',     // documentazione (TEST-NET-3)
  '224.0.0.0/4',        // multicast
  '240.0.0.0/4',        // riservato
  '255.255.255.255/32', // broadcast
];

function isPrivateIPv4(ip) {
  return IPV4_DENYLIST.some((cidr) => ipv4InCidr(ip, cidr));
}

// Espande un indirizzo IPv6 (con eventuale "::" e/o IPv4 embedded finale,
// es. "::ffff:127.0.0.1") in un BigInt a 128 bit per poterlo confrontare con
// un prefix/CIDR — Node non ha un CIDR-matcher IPv6 nativo.
function ipv6ToBigInt(ip) {
  let addr = ip;
  const v4Embedded = addr.match(/:((?:\d{1,3}\.){3}\d{1,3})$/);
  if (v4Embedded) {
    const v4Long = ipv4ToLong(v4Embedded[1]);
    if (v4Long === null) return null;
    const hex1 = ((v4Long >>> 16) & 0xffff).toString(16);
    const hex2 = (v4Long & 0xffff).toString(16);
    addr = addr.slice(0, addr.length - v4Embedded[1].length) + hex1 + ':' + hex2;
  }

  let headParts;
  let tailParts;
  if (addr.includes('::')) {
    const [head, tail] = addr.split('::');
    headParts = head ? head.split(':').filter(Boolean) : [];
    tailParts = tail ? tail.split(':').filter(Boolean) : [];
    const missing = 8 - headParts.length - tailParts.length;
    if (missing < 0) return null;
    headParts = headParts.concat(Array(missing).fill('0'));
  } else {
    headParts = addr.split(':').filter(Boolean);
    tailParts = [];
  }

  const allParts = headParts.concat(tailParts);
  if (allParts.length !== 8) return null;

  let result = 0n;
  for (const part of allParts) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
    result = (result << 16n) | BigInt(parseInt(part, 16));
  }
  return result;
}

function ipv6InCidr(ip, cidr) {
  const [range, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);
  const ipBig = ipv6ToBigInt(ip);
  const rangeBig = ipv6ToBigInt(range);
  if (ipBig === null || rangeBig === null) return false;
  const fullMask = (1n << 128n) - 1n;
  const mask = bits === 0 ? 0n : (fullMask << BigInt(128 - bits)) & fullMask;
  return (ipBig & mask) === (rangeBig & mask);
}

const IPV6_DENYLIST = [
  '::1/128',       // loopback
  '::/128',        // unspecified
  'fc00::/7',       // unique local (RFC4193) — copre fc00:: e fd00::
  'fe80::/10',      // link-local
  '64:ff9b::/96',   // NAT64 well-known prefix (può incapsulare un IPv4 privato)
];

function isPrivateIPv6(ip) {
  // IPv4-mapped (::ffff:a.b.c.d): la minaccia reale è l'IPv4 incapsulato.
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return IPV6_DENYLIST.some((cidr) => ipv6InCidr(ip, cidr));
}

function isPrivateOrReservedIp(ip) {
  if (!ip) return true; // niente indirizzo = tratta come non sicuro (fail-closed)
  if (ip.includes(':')) return isPrivateIPv6(ip);
  return isPrivateIPv4(ip);
}

// Hostname "ovviamente" locali che non vale la pena nemmeno risolvere via
// DNS (alcuni ambienti risolvono "localhost" in modi sorprendenti, es. via
// /etc/hosts manomesso, mDNS, o un resolver locale non standard).
const LOCAL_HOSTNAME_SUFFIXES = ['.localhost', '.local', '.internal'];
function isObviouslyLocalHostname(hostname) {
  const h = hostname.toLowerCase();
  if (h === 'localhost') return true;
  return LOCAL_HOSTNAME_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

/**
 * Valida un URL di destinazione webhook prima di chiamarlo: protocollo,
 * hostname "ovviamente" locale, e risoluzione DNS reale con controllo di
 * OGNI indirizzo risolto (dns.lookup con `all:true`: un hostname può avere
 * più A/AAAA record, un solo indirizzo pubblico "di facciata" non basta a
 * fidarsi se ce n'è anche uno privato).
 *
 * Ritorna { safe: true, addresses } oppure { safe: false, reason }.
 */
async function validateWebhookUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return { safe: false, reason: 'URL non valido' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, reason: `Protocollo non ammesso: ${parsed.protocol}` };
  }

  const hostname = parsed.hostname;
  if (!hostname) {
    return { safe: false, reason: 'Hostname mancante' };
  }
  if (isObviouslyLocalHostname(hostname)) {
    return { safe: false, reason: `Hostname locale non ammesso: ${hostname}` };
  }

  let addresses;
  try {
    // all:true — vede TUTTI gli indirizzi risolti, non solo il primo (Node
    // sceglierebbe altrimenti in modo non deterministico tra IPv4/IPv6).
    // verbatim:true — non riordina i risultati (irrilevante per la
    // sicurezza qui, ma evita sorprese rispetto a quanto vedrebbe fetch()).
    const results = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    addresses = results.map((r) => r.address);
  } catch (err) {
    return { safe: false, reason: `Risoluzione DNS fallita: ${err.message || err}` };
  }

  if (addresses.length === 0) {
    return { safe: false, reason: 'Nessun indirizzo risolto per l\'hostname' };
  }

  const blocked = addresses.find((addr) => isPrivateOrReservedIp(addr));
  if (blocked) {
    return { safe: false, reason: `L'hostname risolve a un indirizzo privato/riservato: ${blocked}` };
  }

  return { safe: true, addresses };
}

module.exports = {
  isPrivateOrReservedIp,
  isObviouslyLocalHostname,
  validateWebhookUrl,
};
