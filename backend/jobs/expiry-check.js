const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');

let resend = null;
try {
  const { Resend } = require('resend');
  if (process.env.RESEND_API_KEY) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
} catch {
  console.log('[Cron] Resend non configurato - invio email disabilitato');
}

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
} else {
  console.log('[Cron] Supabase non configurato - controllo scadenze disabilitato');
}

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@zeusx.com';

// Esegui controllo ogni giorno alle 9:00 AM
if (!supabase) {
  console.log('[Cron] Supabase non disponibile, job non avviato');
  module.exports = { startExpiryCheck: () => console.log('[Cron] Expiry check job skipped - Supabase not configured') };
} else {
  cron.schedule('0 9 * * *', async () => {
  console.log('[Cron] Avvio controllo scadenze app...');
  
  try {
    const now = new Date();
    const fiveDaysFromNow = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

    // 1. App in scadenza tra 5 giorni (invia avviso email)
    const { data: expiringApps, error: expiringError } = await supabase
      .from('apps')
      .select('id, name, client_email, expires_at, slug, tenant_id')
      .eq('client_active', true)
      .eq('expiry_warning_sent', false)
      .gte('expires_at', now.toISOString())
      .lte('expires_at', fiveDaysFromNow.toISOString());

    if (expiringError) {
      console.error('[Cron] Errore query app in scadenza:', expiringError);
    } else if (expiringApps && expiringApps.length > 0) {
      console.log(`[Cron] Trovate ${expiringApps.length} app in scadenza entro 5 giorni`);
      
      for (const app of expiringApps) {
        if (app.client_email) {
          await sendExpiryWarningEmail(app);
        }
        
        // Segna come avviso inviato
        await supabase
          .from('apps')
          .update({ expiry_warning_sent: true })
          .eq('id', app.id);
      }
    }

    // 2. App scadute da più di 5 giorni (blocco automatico)
    const { data: expiredApps, error: expiredError } = await supabase
      .from('apps')
      .select('id, name, client_email, expires_at, slug')
      .eq('client_active', true)
      .lte('expires_at', fiveDaysAgo.toISOString());

    if (expiredError) {
      console.error('[Cron] Errore query app scadute:', expiredError);
    } else if (expiredApps && expiredApps.length > 0) {
      console.log(`[Cron] Trovate ${expiredApps.length} app scadute da oltre 5 giorni - blocco automatico`);
      
      for (const app of expiredApps) {
        await supabase
          .from('apps')
          .update({ client_active: false })
          .eq('id', app.id);
        
        if (app.client_email) {
          await sendBlockedEmail(app);
        }
      }
    }

    console.log('[Cron] Controllo scadenze completato');
  } catch (err) {
    console.error('[Cron] Errore generale:', err);
  }
  });
}

async function sendExpiryWarningEmail(app) {
  const expiresInDays = Math.ceil((new Date(app.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const accessUrl = `${process.env.APP_URL || 'https://zeusxapps.com'}/a/${app.slug}`;

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: app.client_email,
      subject: `Il tuo abbonamento a ${app.name} scade tra ${expiresInDays} giorni`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f59e0b;">⚠️ Avviso scadenza abbonamento</h2>
          <p>Gentile cliente,</p>
          <p>Il tuo abbonamento al gestionale <strong>${app.name}</strong> scadrà tra <strong>${expiresInDays} giorni</strong>.</p>
          <p>Per continuare ad accedere al servizio, contatta il tuo fornitore per rinnovare l'abbonamento.</p>
          <p style="margin-top: 20px;">
            <a href="${accessUrl}" style="background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px;">
              Accedi al gestionale
            </a>
          </p>
          <p style="color: #6b7280; font-size: 12px; margin-top: 40px;">
            Questo messaggio è stato inviato automaticamente. Non rispondere a questa email.
          </p>
        </div>
      `,
    });
    console.log(`[Email] Avviso scadenza inviato a ${app.client_email}`);
  } catch (err) {
    console.error(`[Email] Errore invio avviso a ${app.client_email}:`, err);
  }
}

async function sendBlockedEmail(app) {
  const accessUrl = `${process.env.APP_URL || 'https://zeusxapps.com'}/a/${app.slug}`;

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: app.client_email,
      subject: `Accesso sospeso a ${app.name}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #ef4444;">⛔ Accesso sospeso</h2>
          <p>Gentile cliente,</p>
          <p>L'accesso al gestionale <strong>${app.name}</strong> è stato sospeso a causa della scadenza dell'abbonamento.</p>
          <p>Per riattivare il servizio, contatta il tuo fornitore.</p>
          <p style="margin-top: 20px;">
            <a href="${accessUrl}" style="background: #6b7280; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px;">
              Vai al gestionale
            </a>
          </p>
          <p style="color: #6b7280; font-size: 12px; margin-top: 40px;">
            Questo messaggio è stato inviato automaticamente. Non rispondere a questa email.
          </p>
        </div>
      `,
    });
    console.log(`[Email] Notifica blocco inviata a ${app.client_email}`);
  } catch (err) {
    console.error(`[Email] Errore invio notifica a ${app.client_email}:`, err);
  }
}

module.exports = { startExpiryCheck: () => console.log('[Cron] Expiry check job started') };
