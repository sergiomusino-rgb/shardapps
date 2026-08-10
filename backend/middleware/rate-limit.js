const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;

// Rate limiting sulle route che costano soldi ad ogni chiamata (API AI a
// consumo, creazione sessioni/customer Stripe): protegge da un singolo
// account (o IP) che le martella, non da un attacco distribuito serio — per
// quello serve un livello davanti (Cloudflare/WAF), fuori scope qui.
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Troppe richieste, riprova tra qualche minuto' },
});

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Troppe richieste, riprova tra qualche minuto' },
});

// Chiave composta IP + slug: usata da login e change-password del client
// (FASE 4B, Finding #5). aiLimiter/checkoutLimiter usano la sola IP di
// default, adatta a route autenticate/a consumo dove il bersaglio non
// cambia; qui invece più app (slug diversi) possono trovarsi dietro lo
// stesso IP/NAT (uffici, hotspot condivisi), quindi limitare solo per IP
// bloccherebbe inutilmente i clienti di TUTTE le app di quell'IP per il
// brute-force subito da una sola. `ipKeyGenerator` normalizza l'IP (gestione
// corretta IPv6) prima di comporre la chiave, come richiesto da
// express-rate-limit per un keyGenerator custom.
function ipAndSlugKey(req) {
  return `${ipKeyGenerator(req.ip)}:${req.params.slug || ''}`;
}

// Login cliente (POST /a/:slug in client-app.js): protegge dal brute-force
// della password condivisa dell'app. Soglia più permissiva del
// change-password (10 invece di 5 ogni 15 minuti) perché qui rientrano anche
// i normali errori di battitura di un utente legittimo che digita la
// password a mano, non solo tentativi automatizzati.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipAndSlugKey,
  message: { error: 'Troppi tentativi di accesso, riprova tra qualche minuto' },
});

// Cambio password cliente (POST /a/:slug/change-password): richiede comunque
// la password attuale in chiaro nel body, quindi è anch'esso un bersaglio di
// brute-force (indovinare oldPassword) oltre che di abuso automatizzato.
// Soglia più stretta del login perché l'azione è più sensibile (porta a un
// cambio di credenziale) e un utente legittimo la usa raramente rispetto al
// login.
const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipAndSlugKey,
  message: { error: 'Troppi tentativi, riprova tra qualche minuto' },
});

module.exports = { aiLimiter, checkoutLimiter, loginLimiter, changePasswordLimiter };
