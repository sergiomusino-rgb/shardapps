'use strict';

// ─── Alerting minimo — Pre-Beta Hardening, Blocco 7 ─────────────────────────
// Riusa captureError (lib/error-tracking.js) come UNICO punto di raccolta:
// ogni captureError già in uso nelle route critiche (generazione, publish,
// provisioning, webhook, job schedulati) chiama anche maybeSendAlert qui —
// nessun secondo sistema di logging, nessuna piattaforma nuova (Sentry/
// Datadog) introdotta senza autorizzazione.
//
// Canali (nessuno richiesto = alerting disattivato, mai un errore, mai un
// comportamento diverso per il chiamante):
// - Email via Resend (stesso provider/chiave già in uso altrove nel repo,
//   RESEND_API_KEY/RESEND_FROM_EMAIL), a ALERT_EMAIL_TO.
// - Webhook generico (POST JSON `{ text: ... }`, compatibile con Slack/
//   Discord/qualunque endpoint che accetti JSON) a ALERT_WEBHOOK_URL.
// Se nessuna delle due env var è configurata, maybeSendAlert è un no-op
// silenzioso — stesso principio già seguito da action-dispatcher.js per
// send_notification quando Resend non è configurato.
//
// Dedup: lo stesso `route` non genera un secondo alert entro
// ALERT_DEDUP_WINDOW_MS (default 15 minuti) — un errore che si ripete ad ogni
// richiesta (es. un provider AI down) non deve floodare la casella email o il
// canale webhook. Stato in-memory per processo: sufficiente per "minimo",
// nessuna tabella/coda nuova.

const DEDUP_WINDOW_MS = Number(process.env.ALERT_DEDUP_WINDOW_MS || 15 * 60 * 1000);
const lastAlertAt = new Map(); // route -> timestamp ultimo alert inviato

let resend = null;
try {
  const { Resend } = require('resend');
  if (process.env.RESEND_API_KEY) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
} catch {
  // Nessun pacchetto/chiave: alerting via email resta disattivato, mai un throw.
}

function isEmailConfigured() {
  return !!(process.env.ALERT_EMAIL_TO && resend);
}
function isWebhookConfigured() {
  return !!process.env.ALERT_WEBHOOK_URL;
}

function shouldSend(route, now = Date.now()) {
  const last = lastAlertAt.get(route);
  if (last && now - last < DEDUP_WINDOW_MS) return false;
  lastAlertAt.set(route, now);
  return true;
}

function formatAlertText(entry) {
  const ctx = entry.context && Object.keys(entry.context).length ? ` | context=${JSON.stringify(entry.context)}` : '';
  return `[ShardApps ALERT] ${entry.route}: ${entry.message}${ctx}`;
}

async function defaultSendEmail(entry) {
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'noreply@zeusx.com',
    to: process.env.ALERT_EMAIL_TO,
    subject: `[ShardApps ALERT] ${entry.route}`,
    html: `<pre style="font-family:monospace;white-space:pre-wrap;">${formatAlertText(entry)}</pre>`,
  });
}

async function defaultSendWebhook(entry) {
  await fetch(process.env.ALERT_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: formatAlertText(entry) }),
    signal: AbortSignal.timeout(5000),
  });
}

/**
 * Notifica un umano di un errore critico già catturato da captureError.
 * Non lancia mai, non blocca mai il chiamante (va sempre invocata senza
 * `await` bloccante da chi la chiama, o comunque il suo fallimento non deve
 * mai propagarsi). `deps` iniettabili SOLO per i test (sendEmail/sendWebhook/
 * now) — i chiamanti reali non li passano mai.
 */
async function maybeSendAlert(entry, deps = {}) {
  const sendEmail = deps.sendEmail || defaultSendEmail;
  const sendWebhook = deps.sendWebhook || defaultSendWebhook;
  const now = deps.now ? deps.now() : Date.now();

  if (!isEmailConfigured() && !isWebhookConfigured()) return;
  if (!shouldSend(entry.route, now)) return;

  if (isEmailConfigured()) {
    try {
      await sendEmail(entry);
    } catch (err) {
      console.error('[alerting] invio email fallito:', err.message || err);
    }
  }
  if (isWebhookConfigured()) {
    try {
      await sendWebhook(entry);
    } catch (err) {
      console.error('[alerting] invio webhook fallito:', err.message || err);
    }
  }
}

// Solo per i test: azzera lo stato di dedup tra un test e l'altro (stato di
// modulo condiviso, come il circuit breaker di ai-router.js).
function __resetAlertDedupForTests() {
  lastAlertAt.clear();
}

module.exports = {
  maybeSendAlert,
  shouldSend,
  isEmailConfigured,
  isWebhookConfigured,
  formatAlertText,
  DEDUP_WINDOW_MS,
  __resetAlertDedupForTests,
};
