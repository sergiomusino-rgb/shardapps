-- ============================================================================
-- ShardApps - Pre-Beta Hardening: Cron/Billing reliability (Blocco 2)
-- Data: 2026-08-27
-- ============================================================================
-- Prima di questa migration, expiry-check e workflow-schedule.js giravano
-- SOLO in-process (node-cron) dentro il servizio web di backend/server.js,
-- oggi su un piano Render Free che si addormenta per inattività — un rischio
-- silenzioso sull'enforcement della scadenza abbonamenti, non solo
-- sull'automation. Questa migration introduce il lock atomico che rende
-- sicuro spostare questi job su un Render Cron Job dedicato (vedi
-- backend/scripts/run-scheduled-jobs.js) SENZA rischiare doppie esecuzioni
-- se, durante la transizione, sia il node-cron in-process (ancora disponibile
-- per compatibilità, disattivabile via CRON_MODE=external) sia il nuovo cron
-- job dedicato risultassero attivi contemporaneamente.
--
-- Pattern: stesso principio di idempotenza già in uso per i webhook Stripe
-- (isDuplicateSessionError, backend/lib/stripe-webhook-logic.js) — un INSERT
-- con vincolo UNIQUE come lock atomico lato database, mai un lock solo
-- applicativo (che non protegge da due processi/macchine separate). Vedi
-- backend/lib/cron-lock.js per la logica di acquisizione/uso.
--
-- RLS: stesso pattern deny-all già usato per app_action_logs/ai_usage — solo
-- il backend Express (service_role) vi accede.
-- ============================================================================

CREATE TABLE IF NOT EXISTS cron_job_runs (
  job_name text NOT NULL,
  -- Identifica la finestra di esecuzione (es. '2026-08-27' per un job
  -- giornaliero, un bucket di 15 minuti per uno più frequente) — calcolato
  -- dal chiamante (backend/jobs/*.js), mai da questa tabella.
  run_key text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'failed')),
  error text,
  PRIMARY KEY (job_name, run_key)
);

-- Query di manutenzione/debug ("ultimi run di questo job") e per una futura
-- pulizia periodica delle righe più vecchie di N giorni.
CREATE INDEX IF NOT EXISTS idx_cron_job_runs_started_at ON cron_job_runs (started_at DESC);

ALTER TABLE cron_job_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cron_job_runs_deny_anon_authenticated" ON cron_job_runs FOR ALL
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE cron_job_runs IS 'Lock atomico (INSERT con PK duplicata = lock già preso) contro esecuzioni concorrenti duplicate degli stessi job schedulati (expiry-check, workflow-schedule) — vedi backend/lib/cron-lock.js. Anche un audit trail minimo di quando ogni job è girato/con che esito.';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
