'use strict';

// ─── Cron Lock — protezione da esecuzioni concorrenti duplicate ────────────
// (Pre-Beta Hardening, Blocco 2 — Render/Cron/Billing). Un job schedulato
// (expiry-check, workflow-schedule) può oggi essere invocato da più fonti
// nella stessa finestra di tempo: il node-cron in-process nel servizio web
// (mantenuto per compatibilità, disattivabile via CRON_MODE=external — vedi
// jobs/expiry-check.js/workflow-schedule.js) e il nuovo Render Cron Job
// dedicato (scripts/run-scheduled-jobs.js). Durante la transizione, o per un
// operatore che dimentica di disattivare l'uno quando attiva l'altro,
// entrambi potrebbero tentare lo STESSO run nello stesso istante — un lock
// solo applicativo (in-memory) non protegge da due PROCESSI separati (web
// service + cron job service, PID diversi, magari macchine diverse).
//
// Stesso pattern già in uso per l'idempotenza dei webhook Stripe
// (isDuplicateSessionError, lib/stripe-webhook-logic.js): un INSERT con
// vincolo UNIQUE su (job_name, run_key) come lock atomico a livello
// database — il primo INSERT vince, ogni altro fallisce con 23505
// (violazione UNIQUE) e viene trattato come "un'altra istanza ha già preso
// in carico questo run", non un errore.
//
// run_key identifica la finestra di esecuzione (la data per un job
// giornaliero, un bucket temporale per uno più frequente) — calcolato dal
// chiamante, mai da questo modulo, che resta agnostico rispetto alla
// cadenza di ogni job.

function isDuplicateKeyError(error) {
  return !!error && (error.code === '23505' || /duplicate key value/i.test(error.message || ''));
}

/**
 * Tenta di acquisire il lock per (jobName, runKey). Ritorna true se questa
 * chiamata ha "vinto" (deve eseguire il job), false se un'altra istanza lo
 * ha già preso in carico (deve saltare, senza che sia un errore).
 *
 * Fail-open sui soli errori INATTESI (non 23505, es. la migration non
 * ancora applicata su questo ambiente): un problema nostro nel prendere il
 * lock non deve mai impedire l'esecuzione di un job critico come
 * expiry-check — un'esecuzione doppia occasionale resta innocua (ogni job
 * qui applica solo transizioni idempotenti sui propri dati), nessuna
 * esecuzione affatto no.
 */
async function acquireCronLock(supabase, jobName, runKey) {
  try {
    const { error } = await supabase.from('cron_job_runs').insert({ job_name: jobName, run_key: runKey });
    if (error) {
      if (isDuplicateKeyError(error)) return false;
      console.error(`[cron-lock] errore inatteso acquisendo il lock (${jobName}/${runKey}), procedo comunque (fail-open):`, error);
      return true;
    }
    return true;
  } catch (err) {
    console.error(`[cron-lock] eccezione acquisendo il lock (${jobName}/${runKey}), procedo comunque (fail-open):`, err);
    return true;
  }
}

/**
 * Segna la riga di lock come completata — puramente informativo/di audit
 * (permette di vedere in cron_job_runs quando un job è durato troppo o è
 * fallito), non fa mai fallire il job chiamante.
 */
async function finishCronLock(supabase, jobName, runKey, status, errorMessage) {
  try {
    await supabase
      .from('cron_job_runs')
      .update({ finished_at: new Date().toISOString(), status, error: errorMessage || null })
      .eq('job_name', jobName)
      .eq('run_key', runKey);
  } catch (err) {
    console.error(`[cron-lock] errore aggiornando lo stato del lock (${jobName}/${runKey}):`, err);
  }
}

/**
 * Esegue `fn()` solo se il lock per (jobName, runKey) viene acquisito,
 * marcando sempre l'esito (ok/failed) al termine. Punto unico usato da
 * entrambi i job invece di ripetere lo stesso acquire/finally in ognuno.
 * Ritorna { ran: boolean, error?: Error } — non lancia mai (un job
 * schedulato non deve mai far crashare il processo che lo ospita).
 */
async function withCronLock(supabase, jobName, runKey, fn) {
  const acquired = await acquireCronLock(supabase, jobName, runKey);
  if (!acquired) {
    console.log(`[cron-lock] run già preso in carico da un'altra istanza (${jobName}/${runKey}), salto`);
    return { ran: false };
  }
  try {
    await fn();
    await finishCronLock(supabase, jobName, runKey, 'ok');
    return { ran: true };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    await finishCronLock(supabase, jobName, runKey, 'failed', error.message);
    // Pre-Beta Hardening, Blocco 7: unico punto che copre il fallimento di
    // QUALUNQUE job schedulato (expiry-check, workflow-tick) — un job
    // critico che fallisce (es. l'enforcement di scadenza abbonamenti non
    // gira) deve essere visibile a un umano, non solo in un log che nessuno
    // legge finché un cliente non si lamenta. Require lazy: error-tracking.js
    // non deve mai impedire a un job di girare se, per qualche motivo,
    // risultasse non disponibile in un dato ambiente.
    try {
      const { captureError } = require('./error-tracking');
      captureError(`cron.${jobName}`, error, { runKey });
    } catch {
      // vedi commento sopra: mai bloccare il job per questo.
    }
    return { ran: true, error };
  }
}

module.exports = { acquireCronLock, finishCronLock, withCronLock, isDuplicateKeyError };
