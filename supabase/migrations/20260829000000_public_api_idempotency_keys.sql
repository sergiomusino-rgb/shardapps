-- ─── Public API idempotency keys (Public API Round 2) ──────────────────────
-- Prima, un retry del CHIAMANTE su POST /api/v1/apps/:appId/entities/:entity
-- (timeout di rete, riprova automatica di un client HTTP) poteva creare due
-- record identici — nessun modo per il consumer esterno di segnalare "questa
-- è la stessa richiesta di prima". Un'Idempotency-Key opzionale (header
-- standard, stesso pattern usato da Stripe/altre API REST mature) permette
-- di replay-are la risposta già data invece di rieseguire l'azione.
--
-- Scope: solo POST /entities/:entity (l'unica route che crea qualcosa di
-- nuovo e non è naturalmente idempotente — PATCH è un merge, DELETE è già
-- idempotente by design, GET non muta nulla). Chiave composta (app_id, key):
-- la stessa Idempotency-Key su app diverse non collide mai (isolamento
-- tenant/app, stesso principio del resto della Public API).
--
-- RLS: stesso pattern deny-all già usato per app_action_logs/ai_usage/
-- cron_job_runs — solo il backend Express (service_role) vi accede.

CREATE TABLE IF NOT EXISTS public_api_idempotency_keys (
  app_id uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, idempotency_key)
);

-- Manutenzione/debug e una futura pulizia periodica delle chiavi più vecchie
-- di N giorni (stesso pattern di idx_cron_job_runs_started_at).
CREATE INDEX IF NOT EXISTS idx_public_api_idempotency_keys_created_at ON public_api_idempotency_keys (created_at DESC);

ALTER TABLE public_api_idempotency_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_api_idempotency_keys_deny_anon_authenticated" ON public_api_idempotency_keys FOR ALL
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public_api_idempotency_keys IS 'Risposte memorizzate per Idempotency-Key su POST /api/v1/apps/:appId/entities/:entity (Public API Round 2) — un retry con la stessa chiave replica la risposta invece di ricreare il record. Vedi backend/routes/public-api.js.';
