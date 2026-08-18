const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const { withCronLock } = require('../lib/cron-lock');
// Invio email centralizzato (Notifications, Pre-Beta Hardening Round 2) —
// prima questo file inizializzava un proprio client Resend inline; ora
// delega a lib/email.js (timeout+retry+template condivisi) e rispetta
// apps.notification_preferences.email, come lib/action-dispatcher.js.
const { sendTemplatedEmail } = require('../lib/email');

// ─── Pre-Beta Hardening, Blocco 2 (Render/Cron/Billing) ────────────────────
// Prima: la logica di controllo scadenze viveva SOLO dentro la callback
// inline di cron.schedule, non testabile né richiamabile fuori da un vero
// avvio del processo. Ora estratta in `runExpiryCheckOnce` (dependency
// injection di supabase + sender email, stesso principio di
// lib/stripe-webhook-handler.js) — chiamata sia dal cron in-process
// (invariato per compatibilità, disattivabile con CRON_MODE=external) sia
// dal nuovo Render Cron Job dedicato (scripts/run-scheduled-jobs.js), sempre
// dietro un lock atomico (withCronLock, lib/cron-lock.js) perché le due fonti
// non eseguano MAI lo stesso run due volte.
//
// CRON_MODE=external: da impostare sul servizio WEB quando il Render Cron
// Job dedicato è attivo, per non far girare più questo stesso controllo in
// due posti — default invariato ('in-process', comportamento preesistente)
// finché quell'env var non viene impostata esplicitamente.
const CRON_MODE = process.env.CRON_MODE || 'in-process';

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
} else {
  console.log('[Cron] Supabase non configurato - controllo scadenze disabilitato');
}

// Preferenza email dell'app (Notifications Round 2): fail-open su colonna
// mancante/malformata (default true), stesso principio di
// action-dispatcher.js::loadAppNotificationContext — la scadenza/il blocco
// abbonamento è comunicazione applicativa (rispetta la preferenza), non
// un'email di sicurezza come password_reset (sempre inviata).
function emailNotificationsEnabled(app) {
  const prefs = app && app.notification_preferences;
  return !(prefs && typeof prefs === 'object' && prefs.email === false);
}

async function defaultSendExpiryWarningEmail(app) {
  if (!emailNotificationsEnabled(app)) {
    console.log(`[Email] Avviso scadenza NON inviato a ${app.client_email}: notifiche email disattivate per questa app`);
    return;
  }
  const expiresInDays = Math.ceil((new Date(app.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const accessUrl = `${process.env.APP_URL || 'https://zeusxapps.com'}/a/${app.slug}`;

  const result = await sendTemplatedEmail(app.client_email, 'billing', {
    title: `Il tuo abbonamento a ${app.name} scade tra ${expiresInDays} giorni`,
    bodyHtml: `<p>Gentile cliente,</p><p>Il tuo abbonamento al gestionale <strong>${app.name}</strong> scadrà tra <strong>${expiresInDays} giorni</strong>. Per continuare ad accedere al servizio, contatta il tuo fornitore per rinnovare l'abbonamento.</p>`,
    ctaUrl: accessUrl,
    ctaLabel: 'Accedi al gestionale',
  }, { appId: app.id, jobName: 'expiry-check.warning' });

  if (result.sent) console.log(`[Email] Avviso scadenza inviato a ${app.client_email}`);
  else if (!result.skipped) console.error(`[Email] Errore invio avviso a ${app.client_email}:`, result.error);
}

async function defaultSendBlockedEmail(app) {
  if (!emailNotificationsEnabled(app)) {
    console.log(`[Email] Notifica blocco NON inviata a ${app.client_email}: notifiche email disattivate per questa app`);
    return;
  }
  const accessUrl = `${process.env.APP_URL || 'https://zeusxapps.com'}/a/${app.slug}`;

  const result = await sendTemplatedEmail(app.client_email, 'billing', {
    title: `Accesso sospeso a ${app.name}`,
    bodyHtml: `<p>Gentile cliente,</p><p>L'accesso al gestionale <strong>${app.name}</strong> è stato sospeso a causa della scadenza dell'abbonamento. Per riattivare il servizio, contatta il tuo fornitore.</p>`,
    ctaUrl: accessUrl,
    ctaLabel: 'Vai al gestionale',
  }, { appId: app.id, jobName: 'expiry-check.blocked' });

  if (result.sent) console.log(`[Email] Notifica blocco inviata a ${app.client_email}`);
  else if (!result.skipped) console.error(`[Email] Errore invio notifica a ${app.client_email}:`, result.error);
}

/**
 * Esegue UN controllo scadenze completo (segnala le app in scadenza entro 5
 * giorni, blocca quelle scadute da più di 5 giorni). Dependency injection di
 * supabase/sender email (stesso principio di lib/stripe-webhook-handler.js):
 * testabile con un fake supabase, senza un vero progetto Supabase né invii
 * email reali. Non lancia mai — un errore imprevisto viene loggato e
 * ritornato in `{ errors }`, mai propagato al chiamante (un job schedulato
 * non deve mai far crashare il processo che lo ospita).
 */
async function runExpiryCheckOnce(supabaseClient, deps = {}) {
  const sendExpiryWarningEmail = deps.sendExpiryWarningEmail || defaultSendExpiryWarningEmail;
  const sendBlockedEmail = deps.sendBlockedEmail || defaultSendBlockedEmail;
  const summary = { warned: 0, blocked: 0, errors: [] };

  console.log('[Cron] Avvio controllo scadenze app...');
  try {
    const now = new Date();
    const fiveDaysFromNow = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

    // 1. App in scadenza tra 5 giorni (invia avviso email)
    const { data: expiringApps, error: expiringError } = await supabaseClient
      .from('apps')
      .select('id, name, client_email, expires_at, slug, tenant_id, notification_preferences')
      .eq('client_active', true)
      .eq('expiry_warning_sent', false)
      .gte('expires_at', now.toISOString())
      .lte('expires_at', fiveDaysFromNow.toISOString());

    if (expiringError) {
      console.error('[Cron] Errore query app in scadenza:', expiringError);
      summary.errors.push(expiringError);
    } else if (expiringApps && expiringApps.length > 0) {
      console.log(`[Cron] Trovate ${expiringApps.length} app in scadenza entro 5 giorni`);

      for (const app of expiringApps) {
        // Un singolo invio email/update fallito (es. sendExpiryWarningEmail
        // che lancia inaspettatamente) non deve interrompere il resto del
        // batch né saltare la sezione successiva (app scadute) — ogni app è
        // indipendente dalle altre.
        try {
          if (app.client_email) {
            await sendExpiryWarningEmail(app);
          }
          await supabaseClient.from('apps').update({ expiry_warning_sent: true }).eq('id', app.id);
          summary.warned += 1;
        } catch (err) {
          console.error(`[Cron] Errore processando avviso scadenza per app ${app.id}:`, err);
          summary.errors.push(err);
        }
      }
    }

    // 2. App scadute da più di 5 giorni (blocco automatico)
    const { data: expiredApps, error: expiredError } = await supabaseClient
      .from('apps')
      .select('id, name, client_email, expires_at, slug, notification_preferences')
      .eq('client_active', true)
      .lte('expires_at', fiveDaysAgo.toISOString());

    if (expiredError) {
      console.error('[Cron] Errore query app scadute:', expiredError);
      summary.errors.push(expiredError);
    } else if (expiredApps && expiredApps.length > 0) {
      console.log(`[Cron] Trovate ${expiredApps.length} app scadute da oltre 5 giorni - blocco automatico`);

      for (const app of expiredApps) {
        try {
          await supabaseClient.from('apps').update({ client_active: false }).eq('id', app.id);
          if (app.client_email) {
            await sendBlockedEmail(app);
          }
          summary.blocked += 1;
        } catch (err) {
          console.error(`[Cron] Errore processando blocco per app ${app.id}:`, err);
          summary.errors.push(err);
        }
      }
    }

    console.log('[Cron] Controllo scadenze completato', summary);
  } catch (err) {
    console.error('[Cron] Errore generale:', err);
    summary.errors.push(err);
  }
  return summary;
}

// run_key giornaliero (UTC): un controllo scadenze una volta al giorno è il
// requisito reale (invariato, era già "0 9 * * *"), il lock deduplica
// eventuali trigger multipli nello stesso giorno da fonti diverse.
function todayRunKey() {
  return new Date().toISOString().slice(0, 10);
}

async function runExpiryCheckOnceLocked() {
  if (!supabase) return;
  await withCronLock(supabase, 'expiry-check', todayRunKey(), () => runExpiryCheckOnce(supabase));
}

function startExpiryCheck() {
  if (!supabase) {
    console.log('[Cron] Expiry check job non avviato (Supabase non configurato)');
    return;
  }
  if (CRON_MODE === 'external') {
    console.log('[Cron] Expiry check in-process disattivato (CRON_MODE=external) — gestito dal Render Cron Job dedicato');
    return;
  }
  // Esegui controllo ogni giorno alle 9:00 AM.
  cron.schedule('0 9 * * *', () => { runExpiryCheckOnceLocked(); });
  console.log('[Cron] Expiry check job avviato (in-process, 0 9 * * *)');
}

module.exports = {
  startExpiryCheck,
  runExpiryCheckOnce,
  runExpiryCheckOnceLocked,
  todayRunKey,
  // Esportate per i test (Notifications Round 2): l'implementazione di
  // default degli invii email, prima irraggiungibile dai test se non tramite
  // deps iniettate (che la sostituiscono, non la esercitano).
  defaultSendExpiryWarningEmail,
  defaultSendBlockedEmail,
  emailNotificationsEnabled,
};
