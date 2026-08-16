-- ============================================================================
-- ZeusX - CreatorAI Engine 2.0, Fase 5: AI Agent Orchestrator (generation_jobs)
-- Data: 2026-08-23
-- ============================================================================
-- Macchina a stati PERSISTITA (non un oggetto in memoria) per il processo
-- PLANNER -> GENERATOR -> VALIDATOR -> REPAIR -> READY -> (human approval) ->
-- PUBLISH orchestrato da frontend/src/lib/creator-ai-orchestrator.ts. Nessuna
-- coda distribuita: ogni job viene creato ed eseguito per intero all'interno
-- della stessa richiesta POST /api/creator/generate (stesso modello sincrono
-- già in uso), questa tabella è solo lo stato osservabile/persistito di quel
-- processo, non un sistema di job scheduling.
--
-- app_id è nullable: la generazione avviene SEMPRE prima che un'app esista
-- (POST /api/creator/generate è pura anteprima, non salva mai nulla in
-- `apps` — la persistenza reale avviene solo dopo approvazione umana su
-- /api/creator/publish, invariato da questa fase). Un domani, se
-- publish/route.ts venisse esteso per collegare il job che ha originato la
-- spec pubblicata, valorizzerebbe app_id — non fatto in questa fase.
--
-- RLS: stesso pattern deny-all già usato per app_action_logs/app_credentials/
-- app_rbac_users (vedi 20260813000000_app_action_logs.sql) — nessun accesso
-- diretto dalla Data API pubblica (anon/authenticated), solo dalle route
-- Next.js server-side con la service role key, che filtrano ESPLICITAMENTE
-- per tenant_id del chiamante (creator-generation-jobs.ts) prima di
-- restituire un job — "accessibile solo dal tenant proprietario" è quindi
-- applicativo, non delegato a RLS permissive lato client (che qui non
-- esistono affatto, per design: nessun pannello legge questa tabella
-- direttamente da Supabase browser client).
-- ============================================================================

CREATE TABLE IF NOT EXISTS generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Nullable per design (vedi sopra): ON DELETE SET NULL, non CASCADE — la
  -- cancellazione di un'app pubblicata non deve mai far sparire la storia
  -- del job che l'ha generata, solo scollegarla.
  app_id uuid REFERENCES apps(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  status text NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning', 'generating', 'validating', 'repairing', 'ready', 'failed')),
  -- Passo corrente in forma libera (es. 'planner', 'generator', 'validator',
  -- 'repair:1', 'repair:2', 'fallback') — osservabilità più fine di `status`
  -- da solo, senza dover introdurre uno stato Postgres per ogni sotto-passo.
  current_step text,

  user_prompt text,
  -- Contesto non sensibile della richiesta (projectType, sector, lang, ...):
  -- MAI un token/API key (vedi vincolo "nessun segreto persistito" sotto).
  context jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Output del Planner (piano breve pre-generazione: projectType, settore,
  -- entità principali, pagine, eventuali workflow, caratteristiche) — NULL se
  -- il Planner fallisce/viene saltato (non bloccante, vedi orchestrator).
  plan jsonb,
  -- AppSpecification (o SiteBlueprintJSON sanitizzato) risultante, valorizzata
  -- solo quando status='ready'.
  specification jsonb,
  -- Traccia di ogni tentativo (validator errors, repair attempts, se è stato
  -- usato il fallback) — audit trail del processo, mai dati sensibili.
  artifacts jsonb NOT NULL DEFAULT '{}'::jsonb,

  error text,
  retry_count integer NOT NULL DEFAULT 0,
  fallback_used boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_generation_jobs_tenant_id ON generation_jobs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_app_id ON generation_jobs(app_id) WHERE app_id IS NOT NULL;

-- Riusa la funzione già esistente (definita nella migration master schema):
-- stesso trigger pattern di ogni altra tabella con updated_at in questo repo.
DROP TRIGGER IF EXISTS tr_generation_jobs_updated_at ON generation_jobs;
CREATE TRIGGER tr_generation_jobs_updated_at BEFORE UPDATE ON generation_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE generation_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "generation_jobs_deny_anon_authenticated" ON generation_jobs;
CREATE POLICY "generation_jobs_deny_anon_authenticated" ON generation_jobs FOR ALL
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE generation_jobs IS 'Macchina a stati persistita del processo AI Orchestrator (planner->generator->validator->repair->ready/failed) — CreatorAI Engine 2.0, Fase 5. Vedi frontend/src/lib/creator-ai-orchestrator.ts.';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
