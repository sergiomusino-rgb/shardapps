// ─── Alerting minimo — Pre-Beta Hardening, Blocco 7 ─────────────────────────
// Controparte TypeScript di backend/lib/alerting.js — stessa interfaccia,
// stesso motivo dei due moduli separati (frontend Next.js e backend Express
// sono due progetti npm distinti). Vedi il commento esteso in quel file per
// canali/dedup/filosofia "mai configurato = mai un errore".

export interface AlertEntry {
  route: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface MaybeSendAlertDeps {
  sendEmail?: (entry: AlertEntry) => Promise<void>;
  sendWebhook?: (entry: AlertEntry) => Promise<void>;
  now?: () => number;
}

const DEDUP_WINDOW_MS = Number(process.env.ALERT_DEDUP_WINDOW_MS || 15 * 60 * 1000);
const lastAlertAt = new Map<string, number>();

function isEmailConfigured(): boolean {
  return !!(process.env.ALERT_EMAIL_TO && process.env.RESEND_API_KEY);
}
function isWebhookConfigured(): boolean {
  return !!process.env.ALERT_WEBHOOK_URL;
}

export function shouldSend(route: string, now: number = Date.now()): boolean {
  const last = lastAlertAt.get(route);
  if (last && now - last < DEDUP_WINDOW_MS) return false;
  lastAlertAt.set(route, now);
  return true;
}

export function formatAlertText(entry: AlertEntry): string {
  const ctx = entry.context && Object.keys(entry.context).length ? ` | context=${JSON.stringify(entry.context)}` : '';
  return `[ShardApps ALERT] ${entry.route}: ${entry.message}${ctx}`;
}

async function defaultSendEmail(entry: AlertEntry): Promise<void> {
  // REST API diretta (fetch), non l'SDK 'resend' — il pacchetto npm 'resend'
  // non è una dipendenza del frontend (solo del backend Express): stesso
  // identico pattern già in uso in app/api/admin/takeover/route.ts, l'unico
  // altro punto del frontend che invia email via Resend.
  const res = await fetch('https://api.resend.com/v1/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || 'noreply@zeusx.com',
      to: [process.env.ALERT_EMAIL_TO],
      subject: `[ShardApps ALERT] ${entry.route}`,
      html: `<pre style="font-family:monospace;white-space:pre-wrap;">${formatAlertText(entry)}</pre>`,
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`Resend API ${res.status}`);
  }
}

async function defaultSendWebhook(entry: AlertEntry): Promise<void> {
  await fetch(process.env.ALERT_WEBHOOK_URL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: formatAlertText(entry) }),
    signal: AbortSignal.timeout(5000),
  });
}

/**
 * Notifica un umano di un errore critico già catturato da captureError. Non
 * lancia mai. `deps` iniettabili SOLO per i test — i chiamanti reali non li
 * passano mai.
 */
export async function maybeSendAlert(entry: AlertEntry, deps: MaybeSendAlertDeps = {}): Promise<void> {
  const sendEmail = deps.sendEmail || defaultSendEmail;
  const sendWebhook = deps.sendWebhook || defaultSendWebhook;
  const now = deps.now ? deps.now() : Date.now();

  if (!isEmailConfigured() && !isWebhookConfigured()) return;
  if (!shouldSend(entry.route, now)) return;

  if (isEmailConfigured()) {
    try {
      await sendEmail(entry);
    } catch (err) {
      console.error('[alerting] invio email fallito:', err instanceof Error ? err.message : err);
    }
  }
  if (isWebhookConfigured()) {
    try {
      await sendWebhook(entry);
    } catch (err) {
      console.error('[alerting] invio webhook fallito:', err instanceof Error ? err.message : err);
    }
  }
}

/** Solo per i test: azzera lo stato di dedup tra un test e l'altro. */
export function __resetAlertDedupForTests(): void {
  lastAlertAt.clear();
}

export { isEmailConfigured, isWebhookConfigured, DEDUP_WINDOW_MS };
