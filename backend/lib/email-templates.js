// ─── Email — template condivisi (Notifications, Pre-Beta Hardening Round 2) ─
// Mirror di frontend/src/lib/email-templates.ts — stesso principio di
// password-hash.js/ai-router.js (due progetti npm separati, nessun
// node_modules condiviso, CommonJS qui invece di TS/ESM). Tenere le due
// copie allineate quando si tocca una delle due: la forma di {subject, html}
// e i nomi dei template devono restare identici, un'email inviata dal
// backend (workflow send_notification, expiry-check) deve avere lo stesso
// aspetto di una inviata dal frontend (reset-password, provisioning).

const DEFAULT_ACCENT = '#4f46e5';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function emailShell({ title, bodyHtml, branding, footerNote }) {
  const senderLabel = branding && branding.appName ? escapeHtml(branding.appName) : 'ShardApps';
  return `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
    <h2 style="color: #1e293b; margin-bottom: 16px;">${escapeHtml(title)}</h2>
    ${bodyHtml}
    <p style="color: #64748b; font-size: 12px; margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 16px;">
      ${footerNote || 'Questo messaggio è stato inviato automaticamente.'}
      ${branding && branding.appName ? ` — ${senderLabel} via ShardApps` : ' — ShardApps'}
    </p>
  </div>`;
}

function button(label, href, accentColor) {
  const accent = accentColor || DEFAULT_ACCENT;
  return `<p style="margin: 20px 0;"><a href="${href}" style="display:inline-block;background:${accent};color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">${escapeHtml(label)}</a></p>`;
}

const EMAIL_TEMPLATES = {
  password_reset(data) {
    return {
      subject: 'Reimposta la tua password',
      html: emailShell({
        title: 'Reimposta la password',
        branding: data.branding,
        bodyHtml: `
          <p>Hai richiesto di reimpostare la password ${data.appName ? `per <strong>${escapeHtml(data.appName)}</strong>` : 'per accedere alla tua app'}.</p>
          ${button('Reimposta password', data.resetLink, data.branding && data.branding.accentColor)}
          <p style="color: #64748b; font-size: 13px;">Il link scade tra 15 minuti e può essere usato una sola volta. Se non hai richiesto tu il reset, ignora questa email.</p>
        `,
      }),
    };
  },

  workflow_notification(data) {
    const subject = data.subject || `Notifica da ${data.appName || 'ShardApps'}`;
    return {
      subject,
      html: emailShell({
        title: subject,
        branding: data.branding,
        bodyHtml: `<p>${escapeHtml(data.message || "Un'automazione ha innescato questa notifica.")}</p>`,
      }),
    };
  },

  provisioning(data) {
    return {
      subject: `Il tuo servizio ${data.appName} è pronto`,
      html: emailShell({
        title: 'Il tuo servizio è pronto',
        branding: data.branding,
        bodyHtml: `
          <p>Il tuo gestionale <strong>${escapeHtml(data.appName)}</strong> è stato attivato ed è pronto all'uso.</p>
          ${button('Accedi ora', data.accessUrl, data.branding && data.branding.accentColor)}
        `,
      }),
    };
  },

  billing(data) {
    return {
      subject: data.title,
      html: emailShell({
        title: data.title,
        branding: data.branding,
        bodyHtml: `${data.bodyHtml}${data.ctaUrl ? button(data.ctaLabel || 'Vai al gestionale', data.ctaUrl, data.branding && data.branding.accentColor) : ''}`,
      }),
    };
  },

  // admin_alert: destinatario è sempre un utente/admin reale, niente
  // branding tenant — mittente sempre "ShardApps" puro.
  admin_alert(data) {
    return {
      subject: data.title,
      html: emailShell({ title: data.title, bodyHtml: `<p>${escapeHtml(data.message)}</p>` }),
    };
  },
};

module.exports = { EMAIL_TEMPLATES };
