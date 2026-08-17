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

// Security Audit Fase 4 (fix HIGH — nessun rate limit su azioni/utenti):
// chiave composta appId + IP, sullo stesso principio di ipAndSlugKey sopra
// (più app/utenti dietro lo stesso IP/NAT non devono condividere un budget,
// né un singolo utente rotante-IP deve poter aggirare il limite per una
// specifica app). appId è già disponibile da req.params.appId non appena il
// router matcha la rotta, prima ancora che clientAuthMiddleware giri.
function appIdAndIpKey(req) {
  return `${req.params.appId || ''}:${ipKeyGenerator(req.ip)}`;
}

// POST .../records/:recordId/actions/:actionId: bersaglio diretto sia di
// spam generico (scrittura/DB/log amplification) sia — combinato con un
// webhookUrl configurato — di un uso del backend come proxy di HTTP flood
// verso terzi (vedi SSRF guard in lib/ssrf-guard.js, che blocca i target
// interni ma non impedisce comunque un volume alto verso un target esterno
// legittimo). Finestra corta (1 minuto) perché un utente legittimo che
// aziona più record in sequenza deve restare fluido.
const actionLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: appIdAndIpKey,
  message: { error: 'Troppe azioni eseguite, riprova tra un minuto' },
});

// POST/DELETE .../users: richiede già credenziali admin valide (requireAdminRbac
// in client-app.js), quindi il rischio principale è un account admin
// compromesso o uno script mal scritto, non un attacco anonimo — soglia più
// permissiva ma comunque presente, stessa finestra di login/change-password.
const userManagementLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: appIdAndIpKey,
  message: { error: 'Troppe richieste di gestione utenti, riprova tra qualche minuto' },
});

// ─── Data Export + Public API, Fase 8 — rate limit per API key ─────────────
// Chiave = solo l'id della API key (req.apiKeyId, impostato da
// requireApiKey in lib/public-api-auth.js, montato SEMPRE prima di questo
// limiter nella catena di routes/public-api.js): un rate limit "per API key"
// come richiesto dal task, non globale su tutto ShardApps né sulla sola IP
// (più chiavi/app possono condividere lo stesso IP dietro un unico backend
// integrato lato cliente). Fallback sull'IP nel solo caso limite in cui il
// limiter giri senza che requireApiKey abbia già impostato apiKeyId (non
// dovrebbe mai accadere nell'ordine reale delle route, difensivo).
//
// Finestra/soglia: stesso ordine di grandezza di actionLimiter (finestra
// corta, così un uso legittimo a raffica — es. un import via API — resta
// fluido) ma più permissivo perché qui il chiamante è un sistema esterno
// integrato (non un click umano): 100 richieste/minuto per chiave. Una
// chiave compromessa non può quindi generare traffico illimitato verso i
// dati dell'app.
function apiKeyOrIpKey(req) {
  return req.apiKeyId ? `apikey:${req.apiKeyId}` : `ip:${ipKeyGenerator(req.ip)}`;
}

const publicApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: apiKeyOrIpKey,
  message: { error: 'Rate limit superato per questa API key, riprova tra un minuto' },
});

module.exports = {
  aiLimiter,
  checkoutLimiter,
  loginLimiter,
  changePasswordLimiter,
  actionLimiter,
  userManagementLimiter,
  publicApiLimiter,
};
