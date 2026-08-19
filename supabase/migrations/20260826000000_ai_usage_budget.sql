-- ============================================================================
-- ShardApps - Pre-Beta Hardening: AI Cost Control (Blocco 1)
-- Data: 2026-08-26
-- ============================================================================
-- Prima di questa migration nessuna chiamata AI (OpenRouter, via
-- backend/lib/ai-router.js e frontend/src/lib/ai-router.ts) lasciava una
-- traccia persistita del costo: solo un console.log strutturato, mai
-- aggregabile per tenant/app né utilizzabile per bloccare un consumo fuori
-- controllo. Questa migration introduce:
--
-- 1. ai_usage: una riga per ogni chiamata AI reale (task/provider/model/
--    token/costo), scritta SOLO dal punto centrale del router
--    (frontend/src/lib/ai-usage.ts + backend/lib/ai-usage.js), mai da una
--    singola route — stesso principio di app_action_logs.
-- 2. tenants.ai_daily_budget_usd / ai_monthly_budget_usd: limite di spesa
--    configurabile per tenant. NULL = usa il default di piattaforma
--    (env AI_DEFAULT_DAILY_BUDGET_USD / AI_DEFAULT_MONTHLY_BUDGET_USD, vedi
--    ai-usage.ts/js) — nessun tenant esistente viene lasciato senza limite
--    solo perché la colonna non è stata ancora valorizzata.
--
-- RLS: stesso pattern deny-all già usato per app_action_logs/generation_jobs/
-- app_api_keys — nessun accesso diretto dalla Data API pubblica (anon né
-- authenticated), solo dal backend/route Next.js con service_role.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- nullable: non ogni chiamata AI è legata a un'app già esistente (es. la
  -- generazione di una nuova app non ha ancora un app_id nel momento in cui
  -- l'AI viene chiamata). ON DELETE SET NULL: cancellare un'app non deve mai
  -- far sparire lo storico di costo del tenant, solo scollegarlo dall'app.
  app_id uuid REFERENCES apps(id) ON DELETE SET NULL,
  user_id uuid,
  task text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  -- nullable: non falsifichiamo mai un costo stimato. Se il provider non
  -- restituisce un usage.cost affidabile, la riga viene comunque scritta (per
  -- non perdere la visibilità sul volume di chiamate) con cost_usd NULL —
  -- vedi il fallback esplicito in ai-usage.ts/js.
  cost_usd numeric(12,6),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Query calde: "quanto ha speso il tenant X da inizio giorno/mese" — un
-- range su created_at filtrato per tenant_id, l'indice composito serve
-- esattamente questo pattern senza scan.
CREATE INDEX IF NOT EXISTS idx_ai_usage_tenant_created ON ai_usage (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_app_id ON ai_usage (app_id) WHERE app_id IS NOT NULL;

ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_usage_deny_anon_authenticated" ON ai_usage FOR ALL
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE ai_usage IS 'Una riga per ogni chiamata AI reale (costo/token), scritta esclusivamente da frontend/src/lib/ai-usage.ts e backend/lib/ai-usage.js — mai da una singola route. Base per il budget per-tenant (vedi tenants.ai_daily_budget_usd/ai_monthly_budget_usd).';
COMMENT ON COLUMN ai_usage.cost_usd IS 'Costo reale riportato dal provider (OpenRouter usage.cost). NULL se il provider non lo ha restituito — mai un valore stimato/falsificato.';

-- ─── Budget per tenant ──────────────────────────────────────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ai_daily_budget_usd numeric(12,2);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ai_monthly_budget_usd numeric(12,2);

COMMENT ON COLUMN tenants.ai_daily_budget_usd IS 'Tetto di spesa AI giornaliera in USD per questo tenant. NULL = usa il default di piattaforma (env AI_DEFAULT_DAILY_BUDGET_USD). Superato = le chiamate AI vengono bloccate prima di raggiungere il provider, vedi ai-usage.ts/js::checkAiBudget.';
COMMENT ON COLUMN tenants.ai_monthly_budget_usd IS 'Tetto di spesa AI mensile in USD per questo tenant. NULL = usa il default di piattaforma (env AI_DEFAULT_MONTHLY_BUDGET_USD). Stessa semantica di ai_daily_budget_usd.';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
