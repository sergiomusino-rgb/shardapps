'use strict';

// ─── Email — invio centralizzato (Notifications, Pre-Beta Hardening Round 2) ─
// Prima di questa fase ogni chiamante inizializzava il proprio client Resend
// e gestiva a modo suo (o per niente) timeout/retry: un provider lento
// bloccava la richiesta che l'aveva innescato, un errore transitorio (5xx/
// rete) non veniva mai ritentato. Questo modulo è l'UNICO punto che parla
// con l'API Resend per email transazionali/di notifica lato backend — stessa
// filosofia già applicata a action-dispatcher.js per i webhook in uscita
// (timeout esplicito, retry limitato solo su errori transitori, mai su un
// 4xx permanente, log sempre presente).
//
// Fetch raw verso l'API REST di Resend (non l'SDK 'resend', già una
// dipendenza del progetto ma qui evitata di proposito): stesso identico
// meccanismo di timeout/retry/logging del resto del progetto, senza
// dipendere dal comportamento interno non controllabile dell'SDK.
//
// mittente/reply-to: RESEND_FROM_EMAIL (invariata, già in uso ovunque nel
// progetto) + nuova RESEND_REPLY_TO opzionale — prima nessun chiamante
// impostava mai un reply-to, le risposte dei clienti a un'email
// automatica finivano nel vuoto (noreply@).
const { captureError } = require('./error-tracking');
const { EMAIL_TEMPLATES } = require('./email-templates');

const EMAIL_FETCH_TIMEOUT_MS = 6000;
const MAX_EMAIL_RETRIES = 1; // una sola volta extra: un'email non è un'operazione critica-al-secondo, un retry basta
const EMAIL_RETRY_BACKOFF_MS = Number(process.env.EMAIL_RETRY_BACKOFF_MS || '800');

function fromHeader() {
  const email = process.env.RESEND_FROM_EMAIL || 'noreply@zeusx.com';
  return `ShardApps <${email}>`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientEmailFailure(status, isTimeoutOrNetwork) {
  if (isTimeoutOrNetwork) return true;
  if (status === 429) return true;
  if (status !== undefined && status >= 500) return true;
  return false;
}

async function attemptSend(to, subject, html) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { sent: false, skipped: true, reason: 'RESEND_API_KEY non configurata in questo ambiente' };
  }
  const replyTo = process.env.RESEND_REPLY_TO;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromHeader(),
        to: [to],
        subject,
        html,
        ...(replyTo ? { reply_to: [replyTo] } : {}),
      }),
      signal: AbortSignal.timeout(EMAIL_FETCH_TIMEOUT_MS),
    });
    if (res.ok) return { sent: true, status: res.status };
    const bodyText = await res.text().catch(() => '');
    return { sent: false, status: res.status, error: `Resend HTTP ${res.status}: ${bodyText.slice(0, 300)}` };
  } catch (err) {
    const isTimeout = err.name === 'TimeoutError';
    return { sent: false, isTimeoutOrNetwork: true, error: isTimeout ? `Timeout dopo ${EMAIL_FETCH_TIMEOUT_MS}ms` : (err.message || String(err)) };
  }
}

/**
 * Invia un'email con retry limitato sui soli fallimenti transitori (timeout,
 * rete, 429, 5xx — MAI su un 4xx permanente come un indirizzo rifiutato).
 * Non lancia mai: un invio fallito viene loggato (console + captureError,
 * stesso alerting deduplicato di action-dispatcher.js) e ritornato come
 * { sent:false }, mai propagato al chiamante — un'email è sempre un
 * effetto collaterale, non deve mai far fallire l'operazione primaria
 * (reset password, provisioning, workflow, blocco scadenza).
 */
async function sendEmail(to, { subject, html }, ctx = {}) {
  if (!to || typeof to !== 'string') {
    return { sent: false, error: 'Destinatario mancante' };
  }
  let lastResult;
  for (let attempt = 0; attempt <= MAX_EMAIL_RETRIES; attempt++) {
    const result = await attemptSend(to, subject, html);
    lastResult = result;
    if (result.sent || result.skipped) return result;
    const transient = isTransientEmailFailure(result.status, result.isTimeoutOrNetwork);
    if (!transient || attempt === MAX_EMAIL_RETRIES) break;
    await sleep(EMAIL_RETRY_BACKOFF_MS * (attempt + 1));
  }
  console.error(`[email] invio a ${to} fallito (${ctx.template || 'template sconosciuto'}):`, lastResult.error);
  captureError(`email.${ctx.template || 'unknown'}`, new Error(lastResult.error || 'invio email fallito'), { to, ...ctx });
  return lastResult;
}

/**
 * Compone un template registrato (email-templates.js) e lo invia. Punto
 * d'ingresso preferito per i chiamanti applicativi (send_notification,
 * expiry-check): evita che ognuno importi EMAIL_TEMPLATES/sendEmail
 * separatamente e rischi di disallinearsi sulla forma dei dati.
 */
async function sendTemplatedEmail(to, templateName, data, ctx = {}) {
  const template = EMAIL_TEMPLATES[templateName];
  if (!template) {
    return { sent: false, error: `Template email sconosciuto: "${templateName}"` };
  }
  const { subject, html } = template(data);
  return sendEmail(to, { subject, html }, { ...ctx, template: templateName });
}

module.exports = { sendEmail, sendTemplatedEmail, EMAIL_TEMPLATES };
