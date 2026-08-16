// ─── Action Dispatcher (Fase 4 CreatorAI) ──────────────────────────────────
// Esegue le azioni di entità di tipo 'trigger_webhook' e 'send_notification'
// (adminPanel.entities[].actions, vedi frontend/src/lib/site-schema.ts) —
// prima rispondevano 501 "non ancora implementato" (Fase 3). Struttura
// pensata per essere estesa da un vero provider (Resend/Novu per le notifiche,
// un vero motore di retry per i webhook) senza cambiare il contratto verso
// chi la chiama (backend/routes/client-app.js, endpoint azioni).
//
// Ogni dispatch produce SEMPRE un log (tabella app_action_logs se disponibile,
// altrimenti un console.log strutturato di fallback — mai silenzioso): è
// l'audit trail su cui un consumer futuro (un cron, un webhook di ritorno,
// un pannello "Log Azioni") potrà agganciarsi.
//
// Security Audit Fase 4 (fix BLOCKER SSRF): ogni webhookUrl viene risolto via
// DNS e validato contro una denylist di IP privati/riservati (vedi
// lib/ssrf-guard.js) PRIMA di qualunque fetch — mai fidarsi del solo prefisso
// http(s) già applicato in site-schema.ts, che non può vedere a cosa risolve
// davvero un hostname (né seguire redirect in modo sicuro).
const { validateWebhookUrl } = require('./ssrf-guard');

// Timeout esplicito sul fetch verso il webhook: senza, una destinazione lenta
// o che non risponde terrebbe aperta la connessione indefinitamente — questo
// endpoint è fire-and-forget rispetto al client, ma non deve poter esaurire
// socket/memoria del processo backend (vedi audit, Focus 7 DoS).
const WEBHOOK_FETCH_TIMEOUT_MS = 5000;

// ─── Fase 4 (Logic/Workflow Engine): provider reale per send_notification ──
// Stesso identico pattern difensivo di backend/jobs/expiry-check.js (unico
// altro punto del backend che invia email oggi): require lazy, mai un throw
// a module-load se il pacchetto o la env var mancano — send_notification
// deve continuare a "funzionare" (loggare, mai rompere il workflow) anche
// senza Resend configurato in un dato ambiente. NON un nuovo provider: stessa
// integrazione, stessa env var RESEND_API_KEY/RESEND_FROM_EMAIL già in uso.
let resend = null;
try {
  const { Resend } = require('resend');
  if (process.env.RESEND_API_KEY) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
} catch {
  console.log('[action-dispatcher] Resend non configurato - send_notification resta solo log');
}
const NOTIFICATION_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@zeusx.com';

// Log "dispatched" subito, poi un log separato asincrono con l'esito reale
// della consegna (delivered/failed) quando conosciuto — stesso principio di
// "rispondi subito, esegui il resto in background" già usato altrove nel
// progetto per non far dipendere la risposta HTTP al client da una chiamata
// esterna potenzialmente lenta o instabile.
//
// actorRole/actorEmail (Security Audit Fase 4, Focus 5 — attribution): chi
// ha innescato l'azione, per rendere l'audit trail utile in modo forense e
// non solo "quale app". actorEmail è valorizzato solo per utenti auth_mode=
// 'rbac' (le app legacy non hanno un concetto di utente individuale, resta
// null lì — comportamento coerente, non un dato mancante per errore).
async function logAction(supabase, { appId, tenantId, recordId, entity, action, status, payload, error, actorRole, actorEmail, workflowId, eventType, retryCount }) {
  const entry = {
    app_id: appId,
    tenant_id: tenantId,
    record_id: recordId || null,
    entity,
    action_id: action.id,
    action_type: action.type,
    status,
    payload: payload || {},
    error: error || null,
    actor_role: actorRole || null,
    actor_email: actorEmail || null,
    // Fase 4 (Logic/Workflow Engine, migration 20260822000000): NULL/0 per
    // ogni chiamante esistente (pulsante azione entità) che non li passa —
    // valorizzati solo dal nuovo event-router.js/workflow-action-executor.js
    // per distinguere nello stesso audit trail un'azione diretta da una
    // innescata da un workflow.
    workflow_id: workflowId || null,
    event_type: eventType || null,
    retry_count: retryCount || 0,
  };

  try {
    const { error: insertError } = await supabase.from('app_action_logs').insert(entry);
    if (insertError) throw insertError;
  } catch (err) {
    // La tabella potrebbe non esistere ancora (migration 20260813000000 non
    // applicata al DB remoto) o l'insert può fallire per altri motivi: mai
    // silenzioso, il fallback è un log strutturato — sempre presente nei log
    // del processo anche senza la tabella.
    console.warn('[action-dispatcher] app_action_logs insert non riuscito, fallback su console log:', err.message || err);
  }

  console.log('[action-dispatcher]', JSON.stringify({ ...entry, loggedAt: new Date().toISOString() }));
}

function buildPayload({ appId, recordId, entity, action }) {
  return {
    appId,
    recordId,
    entity,
    action: action.id,
    timestamp: new Date().toISOString(),
  };
}

// trigger_webhook: se l'azione ha un target configurato (action.webhookUrl,
// vedi EntityActionSchema in site-schema.ts), esegue una POST asincrona con
// il payload standard — "asincrona" nel senso che non blocca la risposta
// HTTP di questo endpoint sull'esito della chiamata esterna (che può essere
// lenta/instabile): l'esito reale (delivered/failed) viene comunque loggato
// a parte quando arriva. Senza un URL configurato, l'evento viene comunque
// registrato (dispatched, mai consegnato) — predisposto per l'aggancio
// futuro di un target dall'editor dell'azione, invece di rispondere 501.
//
// Fix SSRF (Security Audit Fase 4, BLOCKER): validateWebhookUrl risolve
// l'hostname via DNS e verifica OGNI indirizzo risolto contro la denylist di
// IP privati/riservati (vedi lib/ssrf-guard.js) — gira ad ogni esecuzione,
// non solo al salvataggio dello schema, perché un dominio "pubblico" al
// momento del salvataggio può risolvere altrove in seguito (DNS rebinding,
// record modificato dal proprietario del dominio). Se non sicuro: NESSUNA
// fetch viene eseguita, l'evento è loggato come 'failed' con il motivo —
// fail-closed, mai un tentativo silenzioso.
async function dispatchTriggerWebhook(supabase, ctx) {
  const { appId, tenantId, recordId, entity, action, actorRole, actorEmail, workflowId, eventType } = ctx;
  const logBase = { appId, tenantId, recordId, entity, action, actorRole, actorEmail, workflowId, eventType };
  const payload = buildPayload(ctx);
  const url = typeof action.webhookUrl === 'string' ? action.webhookUrl.trim() : '';

  if (!url) {
    await logAction(supabase, {
      ...logBase, status: 'dispatched',
      payload: { ...payload, note: 'Nessun webhookUrl configurato sull\'azione: evento solo registrato, nessuna chiamata esterna eseguita.' },
    });
    return { dispatched: true, delivered: false };
  }

  const validation = await validateWebhookUrl(url);
  if (!validation.safe) {
    console.warn(`[action-dispatcher] webhookUrl bloccato (SSRF guard): ${url} — ${validation.reason}`);
    await logAction(supabase, {
      ...logBase, status: 'failed',
      payload, error: `Bloccato da SSRF guard: ${validation.reason}`,
    });
    // dispatched:false — a differenza del caso "nessun webhookUrl", qui
    // l'azione era destinata a un target reale che abbiamo rifiutato: il
    // chiamante non deve credere che qualcosa sia stato inviato.
    return { dispatched: false, delivered: false, blocked: true };
  }

  // Fire-and-forget: la promise non viene attesa da chi chiama
  // dispatchAppAction, il log dell'esito arriva quando la fetch risolve.
  // redirect:'manual' — un 3xx NON viene mai seguito automaticamente (un
  // redirect potrebbe puntare a un indirizzo interno, bypassando il check
  // sopra fatto solo sull'URL originale): trattato come consegna fallita.
  // signal: timeout — un target lento/che non risponde non deve poter
  // tenere aperta la connessione indefinitamente (vedi audit, Focus 7 DoS).
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'manual',
    signal: AbortSignal.timeout(WEBHOOK_FETCH_TIMEOUT_MS),
  })
    .then((res) => {
      const isRedirect = res.status >= 300 && res.status < 400;
      return logAction(supabase, {
        ...logBase,
        status: res.ok ? 'delivered' : 'failed',
        payload,
        error: res.ok ? undefined : (isRedirect ? `Redirect non seguito (HTTP ${res.status})` : `HTTP ${res.status}`),
      });
    })
    .catch((err) => logAction(supabase, {
      ...logBase, status: 'failed', payload,
      error: err.name === 'TimeoutError' ? `Timeout dopo ${WEBHOOK_FETCH_TIMEOUT_MS}ms` : (err.message || String(err)),
    }));

  await logAction(supabase, { ...logBase, status: 'dispatched', payload });
  return { dispatched: true, delivered: null };
}

// ─── send_notification (Fase 4 — Logic/Workflow Engine) ────────────────────
// Prima (Fase 3): nessun provider collegato, solo log. Ora: stesso Resend già
// in uso da backend/jobs/expiry-check.js (NON un nuovo provider), con
// risoluzione del destinatario in due casi:
// - azione diretta (pulsante entità, ctx.notification assente — EntityActionSchema
//   non ha mai avuto un concetto di destinatario): default al titolare
//   dell'app (apps.client_email), comportamento nuovo ma ragionevole ("sei
//   stato avvisato che qualcuno ha premuto questo pulsante"), MAI un invio
//   rotto per mancanza di destinatario.
// - azione di workflow (ctx.notification presente, WorkflowActionSchema):
//   'app_owner' (stesso default sopra) o 'record_field' (email presa da
//   ctx.record.data[recipientField], es. notificare il cliente di un ordine).
// Un errore di invio (Resend non configurato, provider che fallisce) non
// deve MAI interrompere il workflow chiamante: sempre catturato, sempre
// loggato, mai rilanciato.
function resolveNotificationRecipient(ctx) {
  const { notification, record } = ctx;
  if (notification?.recipient === 'record_field' && notification.recipientField) {
    const value = record?.data?.[notification.recipientField];
    if (typeof value === 'string' && value.includes('@')) return value;
    return null; // campo assente/non valorizzato/non un'email: nessun invio, non un default silenzioso su un dato sbagliato
  }
  return 'app_owner'; // default esplicito, sia per azione diretta sia per notification.recipient==='app_owner'
}

async function resolveAppOwnerEmail(supabase, appId) {
  const { data } = await supabase.from('apps').select('client_email, name').eq('id', appId).maybeSingle();
  return { email: data?.client_email || null, appName: data?.name || 'la tua app' };
}

async function dispatchSendNotification(supabase, ctx) {
  const { appId, tenantId, recordId, entity, action, actorRole, actorEmail, workflowId, eventType, notification } = ctx;
  const logBase = { appId, tenantId, recordId, entity, action, actorRole, actorEmail, workflowId, eventType };
  const payload = buildPayload(ctx);

  const recipientKind = resolveNotificationRecipient(ctx);
  if (recipientKind === null) {
    await logAction(supabase, {
      ...logBase, status: 'failed', payload,
      error: `Campo destinatario "${notification?.recipientField}" assente o non è un'email valida sul record`,
    });
    return { dispatched: false, delivered: false };
  }

  let toEmail;
  let appName = entity;
  if (recipientKind === 'app_owner') {
    const owner = await resolveAppOwnerEmail(supabase, appId);
    toEmail = owner.email;
    appName = owner.appName;
  } else {
    toEmail = recipientKind; // già un'email risolta da record_field
  }

  if (!toEmail) {
    await logAction(supabase, { ...logBase, status: 'failed', payload, error: 'Nessun indirizzo email disponibile per il destinatario' });
    return { dispatched: false, delivered: false };
  }

  if (!resend) {
    await logAction(supabase, {
      ...logBase, status: 'dispatched',
      payload: { ...payload, note: 'Resend non configurato in questo ambiente: notifica registrata ma non inviata.' },
    });
    return { dispatched: true, delivered: false };
  }

  const subject = notification?.subject || `Notifica da ${appName}`;
  const message = notification?.message || `L'azione "${action.label}" è stata eseguita su un elemento di ${entity}.`;

  try {
    await resend.emails.send({
      from: NOTIFICATION_FROM_EMAIL,
      to: toEmail,
      subject,
      html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;"><p>${message}</p></div>`,
    });
    await logAction(supabase, { ...logBase, status: 'delivered', payload: { ...payload, to: toEmail } });
    return { dispatched: true, delivered: true };
  } catch (err) {
    console.error('[action-dispatcher] invio notifica fallito:', err.message || err);
    await logAction(supabase, { ...logBase, status: 'failed', payload: { ...payload, to: toEmail }, error: err.message || String(err) });
    return { dispatched: true, delivered: false };
  }
}

/**
 * Punto unico per eseguire un'azione di entità non-change_state — resta
 * l'unico punto che parla con l'esterno (fetch webhook, invio email),
 * riusato tale e quale dal workflow engine (backend/lib/workflow-action-executor.js)
 * invece di duplicare la logica di dispatch/SSRF guard/provider email.
 * ctx: { appId, tenantId, recordId, entity, action, actorRole?, actorEmail?,
 * workflowId?, eventType?, notification?, record? } — action è l'oggetto
 * completo dell'azione (id, label, type, webhookUrl?, ecc.); actorRole/
 * actorEmail identificano chi ha innescato l'azione (Security Audit Fase 4,
 * Focus 5), salvati nel log di audit ma MAI inclusi nel payload inviato al
 * webhook esterno (data minimization). workflowId/eventType (Fase 4,
 * opzionali): presenti solo quando l'azione arriva dal workflow engine, per
 * distinguerla nello stesso audit trail da un'azione diretta via pulsante.
 * notification (Fase 4, solo per send_notification da workflow): { recipient:
 * 'app_owner'|'record_field', recipientField?, subject?, message? } — assente
 * per l'azione diretta via pulsante (in quel caso il destinatario è sempre
 * il titolare dell'app, vedi dispatchSendNotification). record (Fase 4,
 * opzionale): il record completo { id, data }, usato solo per risolvere
 * recipient:'record_field'.
 * Ritorna { dispatched: boolean, delivered: boolean|null, blocked?: boolean }
 * — delivered=null significa "esito non ancora noto" (arriverà via log
 * asincrono); blocked=true significa che l'SSRF guard ha rifiutato l'URL.
 */
async function dispatchAppAction(supabase, ctx) {
  const { action } = ctx;
  if (action.type === 'trigger_webhook') return dispatchTriggerWebhook(supabase, ctx);
  if (action.type === 'send_notification') return dispatchSendNotification(supabase, ctx);
  throw new Error(`dispatchAppAction: tipo azione non gestito "${action.type}"`);
}

module.exports = { dispatchAppAction, logAction };
