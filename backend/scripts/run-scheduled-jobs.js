// ─── Entry point per Render Cron Job — Pre-Beta Hardening, Blocco 2 ────────
// Esegue UNA volta (mai un loop/scheduler proprio, a differenza di
// jobs/expiry-check.js::startExpiryCheck / jobs/workflow-schedule.js::
// startWorkflowTick, entrambi node-cron in-process): il timing è delegato
// interamente a Render Cron Job (vedi render.yaml, servizio
// "shardapps-scheduled-jobs"), che invoca `node scripts/run-scheduled-jobs.js`
// su uno schedule esterno e termina il processo a ogni run — esattamente il
// modello "processo web separato dai job" richiesto, senza introdurre
// keep-alive o ping artificiali: nessuno "sveglia" il servizio web, il cron
// job è la sua stessa infrastruttura dedicata, indipendente dal fatto che il
// servizio web sia addormentato o meno.
//
// Sicuro da eseguire in parallelo/più volte nella stessa finestra (es.
// durante la transizione, se il node-cron in-process del servizio web non è
// ancora stato disattivato con CRON_MODE=external): entrambi i job usano
// withCronLock (lib/cron-lock.js), un lock atomico a livello database — solo
// la prima istanza per (job, finestra) esegue davvero, le altre saltano
// senza errore.
//
// Uso: node scripts/run-scheduled-jobs.js
// Exit code 0 anche se un singolo job fallisce internamente (ogni job già
// cattura i propri errori, vedi runExpiryCheckOnce/tickOnce) — solo un
// errore di AVVIO imprevisto (es. import fallito) produce exit code 1,
// perché Render possa segnalarlo come run fallito.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { createClient } = require('@supabase/supabase-js');
const { runExpiryCheckOnce, todayRunKey } = require('../jobs/expiry-check');
const { tickOnce, currentTickBucketKey } = require('../jobs/workflow-schedule');
const { withCronLock } = require('../lib/cron-lock');

async function main() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('[run-scheduled-jobs] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY non configurate, esco senza eseguire alcun job.');
    process.exit(1);
  }
  const supabase = createClient(url, serviceKey);

  console.log('[run-scheduled-jobs] avvio run schedulato', new Date().toISOString());

  const expiryResult = await withCronLock(supabase, 'expiry-check', todayRunKey(), () => runExpiryCheckOnce(supabase));
  console.log('[run-scheduled-jobs] expiry-check:', expiryResult.ran ? (expiryResult.error ? `fallito: ${expiryResult.error.message}` : 'eseguito') : 'saltato (lock già preso da un\'altra istanza)');

  const tickResult = await withCronLock(supabase, 'workflow-tick', currentTickBucketKey(), () => tickOnce(supabase));
  console.log('[run-scheduled-jobs] workflow-tick:', tickResult.ran ? (tickResult.error ? `fallito: ${tickResult.error.message}` : 'eseguito') : 'saltato (lock già preso da un\'altra istanza)');

  console.log('[run-scheduled-jobs] run completato', new Date().toISOString());
  process.exit(0);
}

main().catch((err) => {
  console.error('[run-scheduled-jobs] errore imprevisto in avvio, run fallito:', err);
  process.exit(1);
});
