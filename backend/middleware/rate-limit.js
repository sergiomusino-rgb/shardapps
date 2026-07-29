const rateLimit = require('express-rate-limit');

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

module.exports = { aiLimiter, checkoutLimiter };
