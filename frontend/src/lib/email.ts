// ─── Email — invio centralizzato (Notifications, Pre-Beta Hardening Round 2) ─
// Mirror di backend/lib/email.js — stesso principio di password-hash.ts/
// ai-router.ts (due progetti npm separati). Unico punto che parla con l'API
// Resend per email transazionali/di notifica lato frontend (reset-password,
// admin/takeover, provisioning): timeout esplicito + retry limitato solo sui
// fallimenti transitori (timeout/rete/429/5xx, mai un 4xx permanente) +
// logging via alerting.ts (stessa dedup già in uso per gli altri errori
// applicativi) — prima ogni chiamante faceva una fetch raw senza timeout né
// retry, con un mittente hardcoded diverso da RESEND_FROM_EMAIL (un bug
// reale: "noreply@zeusx.it" vs "noreply@zeusx.com" usato ovunque altrove).

import { captureError } from './error-tracking.ts';
import { EMAIL_TEMPLATES, type EmailTemplateName } from './email-templates.ts';

const EMAIL_FETCH_TIMEOUT_MS = 6000;
const MAX_EMAIL_RETRIES = 1;
const EMAIL_RETRY_BACKOFF_MS = Number(process.env.EMAIL_RETRY_BACKOFF_MS || '800');

function fromHeader(): string {
  const email = process.env.RESEND_FROM_EMAIL || 'noreply@zeusx.com';
  return `ShardApps <${email}>`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientEmailFailure(status: number | undefined, isTimeoutOrNetwork: boolean | undefined): boolean {
  if (isTimeoutOrNetwork) return true;
  if (status === 429) return true;
  if (status !== undefined && status >= 500) return true;
  return false;
}

interface SendAttemptResult {
  sent: boolean;
  skipped?: boolean;
  status?: number;
  isTimeoutOrNetwork?: boolean;
  error?: string;
  reason?: string;
}

async function attemptSend(to: string, subject: string, html: string): Promise<SendAttemptResult> {
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
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    return { sent: false, isTimeoutOrNetwork: true, error: isTimeout ? `Timeout dopo ${EMAIL_FETCH_TIMEOUT_MS}ms` : (err instanceof Error ? err.message : String(err)) };
  }
}

export interface SendEmailContext {
  template?: string;
  [key: string]: unknown;
}

/**
 * Invia un'email con retry limitato sui soli fallimenti transitori. Non
 * lancia mai: un invio fallito viene loggato (console + captureError) e
 * ritornato come { sent:false }, mai propagato al chiamante.
 */
export async function sendEmail(to: string, content: { subject: string; html: string }, ctx: SendEmailContext = {}): Promise<SendAttemptResult> {
  if (!to || typeof to !== 'string') {
    return { sent: false, error: 'Destinatario mancante' };
  }
  let lastResult: SendAttemptResult = { sent: false, error: 'nessun tentativo eseguito' };
  for (let attempt = 0; attempt <= MAX_EMAIL_RETRIES; attempt++) {
    const result = await attemptSend(to, content.subject, content.html);
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
 * Compone un template registrato (email-templates.ts) e lo invia.
 */
export async function sendTemplatedEmail<K extends EmailTemplateName>(
  to: string,
  templateName: K,
  data: Parameters<(typeof EMAIL_TEMPLATES)[K]>[0],
  ctx: SendEmailContext = {}
): Promise<SendAttemptResult> {
  const template = EMAIL_TEMPLATES[templateName];
  if (!template) {
    return { sent: false, error: `Template email sconosciuto: "${String(templateName)}"` };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { subject, html } = (template as any)(data);
  return sendEmail(to, { subject, html }, { ...ctx, template: templateName as string });
}
