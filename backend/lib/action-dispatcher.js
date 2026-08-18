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
const { captureError } = require('./error-tracking');
// send_notification (sotto): invio email centralizzato (Notifications, Pre-
// Beta Hardening Round 2) — prima questo file inizializzava un proprio
// client Resend con invio inline; ora delega a lib/email.js, l'unico punto
// del backend che parla con Resend (timeout+retry+template condivisi, vedi
// quel file). Nessun nuovo provider, stessa env var RESEND_API_KEY/
// RESEND_FROM_EMAIL già in uso.
const { sendTemplatedEmail } = require('./email');

// Timeout esplicito sul fetch verso il webhook: senza, una destinazione lenta
// o che non risponde terrebbe aperta la connessione indefinitamente — questo
// endpoint è fire-and-forget rispetto al client, ma non deve poter esaurire
// socket/memoria del processo backend (vedi audit, Focus 7 DoS).
const WEBHOOK_FETCH_TIMEOUT_MS = 5000;

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Retry (Pre-Beta Hardening, Blocco 8) ───────────────────────────────────
// Al più MAX_WEBHOOK_RETRIES tentativi extra, SOLO su errori transitori
// (timeout, 429, 5xx) — mai su un 4xx permanente (400/401/403/404/...): un
// target che rifiuta la richiesta con un errore di validazione non
// cambierebbe risposta riprovando. Backoff breve e crescente tra un
// tentativo e l'altro, mai un loop indefinito.
const MAX_WEBHOOK_RETRIES = 2;
const WEBHOOK_RETRY_BACKOFF_MS = Number(process.env.WEBHOOK_RETRY_BACKOFF_MS || '1000');

function isTransientWebhookFailure(status, isTimeoutOrNetwork) {
  if (isTimeoutOrNetwork) return true;
  if (status === 429) return true;
  if (status !== undefined && status >= 500) return true;
  return false;
}

// Header MAI sovrascrivibili da un'azione configurata dal tenant (http_request):
// Host/Content-Length sono gestiti dal runtime fetch stesso (impostarli a
// mano è comunque ignorato dai motori fetch moderni, ma li togliamo comunque
// esplicitamente); Content-Type resta sempre quello deciso qui in base al
// body, mai sovrascrivibile — un content-type inatteso è un vettore comune
// di request smuggling/parsing ambiguo lato target, non un rischio che vale
// la pena correre per un'azione "generica". Case-insensitive: gli header
// HTTP non fanno distinzione di maiuscole/minuscole.
const FORBIDDEN_HTTP_ACTION_HEADERS = new Set(['host', 'content-length', 'content-type']);
const MAX_HTTP_ACTION_HEADERS = 10;

// Sanifica gli header di un'azione http_request: whitelist "per esclusione"
// (tutto ammesso tranne i pochi vietati sopra), tetto sul numero totale per
// non permettere di gonfiare la richiesta. Usata SOLO da http_request:
// trigger_webhook non accetta header custom, resta fisso su
// Content-Type: application/json come sempre.
function sanitizeHttpActionHeaders(rawHeaders) {
  const entries = Object.entries(rawHeaders || {})
    .filter(([k, v]) => typeof k === 'string' && typeof v === 'string' && !FORBIDDEN_HTTP_ACTION_HEADERS.has(k.toLowerCase()))
    .slice(0, MAX_HTTP_ACTION_HEADERS);
  return Object.fromEntries(entries);
}

// Un singolo tentativo di consegna: SEMPRE preceduto da una validazione SSRF
// fresca (mai riusata da un tentativo precedente) — un retry a distanza di
// secondi è una nuova finestra per un DNS rebinding, la stessa ragione per
// cui la validazione originale non viene fatta una sola volta al salvataggio
// dello schema (vedi commento storico più sotto). redirect:'manual' e il
// timeout esplicito restano invariati ad ogni tentativo. `options` (Blocco
// Integrations Round 2): method/headers/body configurabili per http_request,
// default invariati (POST + JSON) per trigger_webhook.
async function attemptWebhookDelivery(url, payload, options = {}) {
  const validation = await validateWebhookUrl(url);
  if (!validation.safe) {
    return { delivered: false, blocked: true, error: `Bloccato da SSRF guard: ${validation.reason}` };
  }
  const method = options.method || 'POST';
  const hasBody = method !== 'GET' && method !== 'DELETE';
  const headers = { ...(options.headers || {}) };
  let body;
  if (hasBody) {
    if (typeof options.body === 'string') {
      body = options.body;
      // Content-Type deciso qui, mai lasciato all'azione configurata (vedi
      // FORBIDDEN_HTTP_ACTION_HEADERS): un body stringa esplicito (http_request)
      // resta testo semplice a meno che sembri già JSON, il payload standard
      // (trigger_webhook) è sempre JSON.
      headers['Content-Type'] = headers['Content-Type'] || 'text/plain';
    } else {
      body = JSON.stringify(payload);
      headers['Content-Type'] = 'application/json';
    }
  }
  try {
    const res = await fetch(url, {
      method,
      headers,
      ...(hasBody ? { body } : {}),
      redirect: 'manual',
      signal: AbortSignal.timeout(WEBHOOK_FETCH_TIMEOUT_MS),
    });
    if (res.ok) return { delivered: true, status: res.status };
    const isRedirect = res.status >= 300 && res.status < 400;
    return {
      delivered: false,
      status: res.status,
      error: isRedirect ? `Redirect non seguito (HTTP ${res.status})` : `HTTP ${res.status}`,
    };
  } catch (err) {
    const isTimeout = err.name === 'TimeoutError';
    return { delivered: false, isTimeoutOrNetwork: true, error: isTimeout ? `Timeout dopo ${WEBHOOK_FETCH_TIMEOUT_MS}ms` : (err.message || String(err)) };
  }
}

// Orchestrazione retry: ritorna l'esito finale + `attempts` (per il log/
// audit trail, vedi retry_count già supportato da app_action_logs). Ogni
// tentativo rivalida SSRF da capo (vedi attemptWebhookDelivery).
async function deliverWebhookWithRetry(url, payload, options = {}) {
  let lastResult;
  for (let attempt = 0; attempt <= MAX_WEBHOOK_RETRIES; attempt++) {
    const result = await attemptWebhookDelivery(url, payload, options);
    lastResult = result;
    if (result.delivered || result.blocked) {
      return { ...result, attempts: attempt + 1 };
    }
    const transient = isTransientWebhookFailure(result.status, result.isTimeoutOrNetwork);
    if (!transient || attempt === MAX_WEBHOOK_RETRIES) {
      return { ...result, attempts: attempt + 1 };
    }
    console.warn(`[action-dispatcher] webhook tentativo ${attempt + 1} fallito (${result.error}), retry breve...`);
    await sleep(WEBHOOK_RETRY_BACKOFF_MS * (attempt + 1));
  }
  return { ...lastResult, attempts: MAX_WEBHOOK_RETRIES + 1 };
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
// IP privati/riservati (vedi lib/ssrf-guard.js) — gira ad ogni esecuzione
// (ogni tentativo, non solo il primo — vedi attemptWebhookDelivery), non
// solo al salvataggio dello schema, perché un dominio "pubblico" al momento
// del salvataggio può risolvere altrove in seguito (DNS rebinding, record
// modificato dal proprietario del dominio). Se non sicuro: NESSUNA fetch
// viene eseguita, l'evento è loggato come 'failed' con il motivo —
// fail-closed, mai un tentativo silenzioso, mai un retry su un blocco SSRF.
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
    // chiamante non deve credere che qualcosa sia stato inviato. Nessun
    // retry: un blocco SSRF è deterministico sull'URL configurato, non un
    // guasto transitorio del target.
    return { dispatched: false, delivered: false, blocked: true };
  }

  // Fire-and-forget: la promise non viene attesa da chi chiama
  // dispatchAppAction, il log dell'esito arriva quando l'ultimo tentativo si
  // conclude. Il primo tentativo qui dentro rivalida SSRF di nuovo (costo
  // trascurabile, un secondo dns.lookup): resta corretto anche se in futuro
  // questa funzione venisse richiamata da un percorso che salta il controllo
  // sincrono sopra.
  deliverWebhookWithRetry(url, payload)
    .then((result) => {
      if (!result.delivered && !result.blocked) {
        // Pre-Beta Hardening, Blocco 7: visibilità su "webhook falliti" come
        // categoria (deduplicata per route, non per singolo target — vedi
        // lib/alerting.js), non un allarme per ogni singola consegna fallita.
        captureError('action-dispatcher.trigger_webhook', new Error(result.error), { appId: logBase.appId, attempts: result.attempts });
      }
      return logAction(supabase, {
        ...logBase,
        status: result.delivered ? 'delivered' : 'failed',
        payload,
        error: result.delivered ? undefined : result.error,
        retryCount: result.attempts - 1,
      });
    })
    .catch((err) => {
      // Rete di sicurezza aggiuntiva: deliverWebhookWithRetry già non lancia
      // in condizioni normali (ogni ramo ritorna un oggetto, mai un throw).
      captureError('action-dispatcher.trigger_webhook', err, { appId: logBase.appId });
      return logAction(supabase, { ...logBase, status: 'failed', payload, error: err.message || String(err) });
    });

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

// Carica in una sola query sia i dati necessari a risolvere il destinatario
// 'app_owner' sia la preferenza di notifica dell'app (notification_preferences,
// Notifications Round 2): la preferenza si applica a QUALUNQUE destinatario
// (anche 'record_field', es. il cliente di un ordine), non solo al titolare —
// "questa app non deve mandare email automatiche" vale per tutte, quindi la
// query serve comunque anche quando il destinatario finale non è l'owner.
async function loadAppNotificationContext(supabase, appId) {
  const { data } = await supabase.from('apps').select('client_email, name, notification_preferences').eq('id', appId).maybeSingle();
  const prefs = data?.notification_preferences;
  // Fail-open sul default (email:true) se la colonna manca ancora (migration
  // non applicata su questo ambiente) o è null/malformata — MAI un blocco
  // silenzioso delle notifiche per un dettaglio di migrazione, stesso
  // principio già seguito da ai-usage.js sui budget mancanti.
  const emailEnabled = prefs && typeof prefs === 'object' && prefs.email === false ? false : true;
  return { email: data?.client_email || null, appName: data?.name || 'la tua app', emailEnabled };
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

  const appCtx = await loadAppNotificationContext(supabase, appId);

  if (!appCtx.emailEnabled) {
    // status resta nel vocabolario esistente di app_action_logs (CHECK
    // constraint su 'dispatched'/'delivered'/'failed', migration
    // 20260813000000): stesso pattern già in uso poco sotto per "Resend non
    // configurato" — un dettaglio nel payload, non un nuovo valore di status.
    await logAction(supabase, {
      ...logBase, status: 'dispatched', payload: { ...payload, note: 'Notifiche email disattivate per questa app (notification_preferences.email=false): notifica registrata ma non inviata.' },
    });
    return { dispatched: true, delivered: false, skipped: true };
  }

  const toEmail = recipientKind === 'app_owner' ? appCtx.email : recipientKind; // 'record_field': già un'email risolta

  if (!toEmail) {
    await logAction(supabase, { ...logBase, status: 'failed', payload, error: 'Nessun indirizzo email disponibile per il destinatario' });
    return { dispatched: false, delivered: false };
  }

  const result = await sendTemplatedEmail(toEmail, 'workflow_notification', {
    subject: notification?.subject,
    message: notification?.message || `L'azione "${action.label}" è stata eseguita su un elemento di ${entity}.`,
    appName: appCtx.appName,
  }, { appId });

  if (result.skipped) {
    await logAction(supabase, {
      ...logBase, status: 'dispatched',
      payload: { ...payload, to: toEmail, note: result.reason || 'Resend non configurato in questo ambiente: notifica registrata ma non inviata.' },
    });
    return { dispatched: true, delivered: false };
  }
  await logAction(supabase, {
    ...logBase, status: result.sent ? 'delivered' : 'failed',
    payload: { ...payload, to: toEmail }, error: result.sent ? undefined : result.error,
  });
  return { dispatched: true, delivered: result.sent };
}

// ─── http_request (Integrations — Pre-Beta Hardening Round 2) ──────────────
// Azione HTTP generica: URL/metodo/header/body scelti dal tenant in fase di
// creazione del workflow (WorkflowActionSchema in site-schema.ts). Stessa
// identica infrastruttura di trigger_webhook (SSRF guard ad ogni tentativo,
// timeout, retry su transitori, mai su blocco SSRF/4xx permanenti) — questa
// funzione non duplica nulla, chiama deliverWebhookWithRetry con le opzioni
// dell'azione invece del payload/metodo fissi di trigger_webhook.
async function dispatchHttpRequest(supabase, ctx) {
  const { appId, tenantId, recordId, entity, action, actorRole, actorEmail, workflowId, eventType } = ctx;
  const logBase = { appId, tenantId, recordId, entity, action, actorRole, actorEmail, workflowId, eventType };
  const payload = buildPayload(ctx);
  const url = typeof action.url === 'string' ? action.url.trim() : '';

  if (!url) {
    await logAction(supabase, { ...logBase, status: 'failed', payload, error: 'Nessun URL configurato sull\'azione http_request' });
    return { dispatched: false, delivered: false };
  }

  const method = typeof action.method === 'string' ? action.method.toUpperCase() : 'POST';
  const headers = sanitizeHttpActionHeaders(action.headers);
  const body = typeof action.body === 'string' ? action.body : undefined;

  // Stesso identico blocco sincrono "prima risposta" di dispatchTriggerWebhook:
  // un blocco SSRF va rilevato PRIMA di rispondere al chiamante, non solo nel
  // retry asincrono in background.
  const validation = await validateWebhookUrl(url);
  if (!validation.safe) {
    console.warn(`[action-dispatcher] http_request bloccato (SSRF guard): ${url} — ${validation.reason}`);
    await logAction(supabase, { ...logBase, status: 'failed', payload, error: `Bloccato da SSRF guard: ${validation.reason}` });
    return { dispatched: false, delivered: false, blocked: true };
  }

  deliverWebhookWithRetry(url, payload, { method, headers, body })
    .then((result) => {
      if (!result.delivered && !result.blocked) {
        captureError('action-dispatcher.http_request', new Error(result.error), { appId: logBase.appId, attempts: result.attempts });
      }
      return logAction(supabase, {
        ...logBase,
        status: result.delivered ? 'delivered' : 'failed',
        payload,
        error: result.delivered ? undefined : result.error,
        retryCount: result.attempts - 1,
      });
    })
    .catch((err) => {
      captureError('action-dispatcher.http_request', err, { appId: logBase.appId });
      return logAction(supabase, { ...logBase, status: 'failed', payload, error: err.message || String(err) });
    });

  await logAction(supabase, { ...logBase, status: 'dispatched', payload: { ...payload, method, note: 'Chiamata HTTP in corso, esito registrato quando disponibile.' } });
  return { dispatched: true, delivered: null };
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
  if (action.type === 'http_request') return dispatchHttpRequest(supabase, ctx);
  throw new Error(`dispatchAppAction: tipo azione non gestito "${action.type}"`);
}

module.exports = {
  dispatchAppAction,
  logAction,
  sanitizeHttpActionHeaders,
  // Esportate per i test (Blocco 8 — retry webhook): dispatchTriggerWebhook
  // stessa non è testabile in isolamento a livello di ESITO perché è
  // fire-and-forget (ritorna prima che il retry finisca) — questi due sono
  // il vero motore testabile direttamente, senza mockare l'intera catena
  // Express/Supabase.
  deliverWebhookWithRetry,
  attemptWebhookDelivery,
  MAX_WEBHOOK_RETRIES,
};
