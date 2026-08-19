// ─── Email — template condivisi (Notifications, Pre-Beta Hardening Round 2) ─
// Prima di questa fase ogni chiamante (reset-password, admin/takeover,
// workflow send_notification, expiry-check) costruiva il proprio HTML inline,
// con markup duplicato e — nel caso di reset-password/takeover — un mittente
// hardcoded ("ShardApps <noreply@zeusx.it>", dominio DIVERSO da
// RESEND_FROM_EMAIL usato ovunque altrove, "noreply@zeusx.com": un bug reale,
// non solo un'inconsistenza cosmetica, corretto centralizzando qui). Modulo
// puro (nessun I/O, nessuna chiamata Resend): solo {subject, html}, spediti
// da src/lib/email.ts (frontend) o backend/lib/email.js (mirror, stesso
// principio di password-hash.js/ai-router.js — due progetti npm separati,
// nessun node_modules condiviso).
//
// branding (opzionale): { appName, accentColor } — quando disponibile (letta
// da apps.config.branding dal chiamante, mai da qui) sostituisce il nome
// generico "ShardApps" e il colore d'accento nell'intestazione/pulsante,
// SENZA mai eliminare la dicitura "via ShardApps" in calce (trasparenza sul
// vero mittente tecnico, coerente con l'essere una piattaforma white-label
// per rivenditori — vedi reseller experience).

export interface EmailBranding {
  appName?: string;
  accentColor?: string;
}

const DEFAULT_ACCENT = '#4f46e5';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function emailShell(opts: { title: string; bodyHtml: string; branding?: EmailBranding; footerNote?: string }): string {
  const senderLabel = opts.branding?.appName ? escapeHtml(opts.branding.appName) : 'ShardApps';
  return `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
    <h2 style="color: #1e293b; margin-bottom: 16px;">${escapeHtml(opts.title)}</h2>
    ${opts.bodyHtml}
    <p style="color: #64748b; font-size: 12px; margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 16px;">
      ${opts.footerNote || 'Questo messaggio è stato inviato automaticamente.'}
      ${opts.branding?.appName ? ` — ${senderLabel} via ShardApps` : ' — ShardApps'}
    </p>
  </div>`;
}

function button(label: string, href: string, accentColor?: string): string {
  const accent = accentColor || DEFAULT_ACCENT;
  return `<p style="margin: 20px 0;"><a href="${href}" style="display:inline-block;background:${accent};color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">${escapeHtml(label)}</a></p>`;
}

export interface PasswordResetData {
  resetLink: string;
  appName?: string;
  branding?: EmailBranding;
}
export interface WorkflowNotificationData {
  subject?: string;
  message?: string;
  appName?: string;
  branding?: EmailBranding;
}
export interface ProvisioningData {
  appName: string;
  accessUrl: string;
  branding?: EmailBranding;
}
export interface BillingData {
  title: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  branding?: EmailBranding;
}
export interface AdminAlertData {
  title: string;
  message: string;
}

export const EMAIL_TEMPLATES = {
  password_reset(data: PasswordResetData) {
    return {
      subject: 'Reimposta la tua password',
      html: emailShell({
        title: 'Reimposta la password',
        branding: data.branding,
        bodyHtml: `
          <p>Hai richiesto di reimpostare la password ${data.appName ? `per <strong>${escapeHtml(data.appName)}</strong>` : 'per accedere alla tua app'}.</p>
          ${button('Reimposta password', data.resetLink, data.branding?.accentColor)}
          <p style="color: #64748b; font-size: 13px;">Il link scade tra 15 minuti e può essere usato una sola volta. Se non hai richiesto tu il reset, ignora questa email.</p>
        `,
      }),
    };
  },

  workflow_notification(data: WorkflowNotificationData) {
    const subject = data.subject || `Notifica da ${data.appName || 'ShardApps'}`;
    return {
      subject,
      html: emailShell({
        title: subject,
        branding: data.branding,
        bodyHtml: `<p>${escapeHtml(data.message || 'Un\'automazione ha innescato questa notifica.')}</p>`,
      }),
    };
  },

  provisioning(data: ProvisioningData) {
    return {
      subject: `Il tuo servizio ${data.appName} è pronto`,
      html: emailShell({
        title: 'Il tuo servizio è pronto',
        branding: data.branding,
        bodyHtml: `
          <p>Il tuo gestionale <strong>${escapeHtml(data.appName)}</strong> è stato attivato ed è pronto all'uso.</p>
          ${button('Accedi ora', data.accessUrl, data.branding?.accentColor)}
        `,
      }),
    };
  },

  billing(data: BillingData) {
    return {
      subject: data.title,
      html: emailShell({
        title: data.title,
        branding: data.branding,
        bodyHtml: `${data.bodyHtml}${data.ctaUrl ? button(data.ctaLabel || 'Vai al gestionale', data.ctaUrl, data.branding?.accentColor) : ''}`,
      }),
    };
  },

  // admin_alert: destinatario è sempre un utente/admin reale (mai un
  // end-user finale del cliente), niente branding tenant — mittente sempre
  // "ShardApps" puro, coerente con l'essere una comunicazione tra la
  // piattaforma e chi la gestisce.
  admin_alert(data: AdminAlertData) {
    return {
      subject: data.title,
      html: emailShell({ title: data.title, bodyHtml: `<p>${escapeHtml(data.message)}</p>` }),
    };
  },
};

export type EmailTemplateName = keyof typeof EMAIL_TEMPLATES;
