-- ============================================================================
-- ZeusX - CreatorAI Engine 2.0, Fase 6: refactor scoped (app_versions)
-- Data: 2026-08-24
-- ============================================================================
-- Cronologia delle configurazioni pubblicate di un'app (snapshot di
-- `apps.config`), necessaria per un rollback sicuro quando un refactor
-- (patch scoped RFC6902 o riscrittura completa di fallback, vedi
-- frontend/src/lib/creator-patch-engine.ts) pubblicato risulta indesiderato.
--
-- Design "snapshot completo", non un diff/patch history: stessa scelta già
-- fatta per la riscrittura completa in app/api/creator/publish/route.ts (un
-- JSONB per riga, mai una sequenza di patch da ricostruire) — più semplice
-- da interrogare/ripristinare, coerente con "NON la vera patch history" già
-- escluso esplicitamente dalla Fase 5.
--
-- Ogni scrittura di `apps.config` (sia una ripubblicazione da
-- /api/creator/publish sia un rollback) è preceduta dallo snapshot dello
-- stato PRIMA di quella scrittura: nessuna configurazione pubblicata va mai
-- persa, un rollback è a sua volta reversibile (il suo "prima" diventa una
-- nuova riga). Nessuna riga viene creata alla PRIMA pubblicazione di un'app
-- (niente da cui fare rollback finché non esiste una versione precedente).
--
-- RLS: stesso pattern deny-all già usato per generation_jobs/app_action_logs
-- — nessun accesso diretto dalla Data API pubblica, solo dalle route Next.js
-- server-side con service role, che filtrano ESPLICITAMENTE per tenant_id
-- (frontend/src/lib/app-versions.ts) prima di restituire/ripristinare una
-- versione.
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Snapshot completo di apps.config COM'ERA prima della scrittura che ha
  -- generato questa riga (mai lo stato "nuovo": vedi nota sopra).
  config jsonb NOT NULL,

  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- 'publish': snapshot preso prima di una ripubblicazione (Salva Modifiche).
  -- 'rollback': snapshot preso prima di un ripristino (il "prima" del rollback).
  source text NOT NULL DEFAULT 'publish' CHECK (source IN ('publish', 'rollback')),
  -- Collegamento facoltativo al generation_job (Fase 5/6) che ha prodotto la
  -- configurazione SOSTITUITA da questa scrittura, se applicabile (patch
  -- scoped o riscrittura completa via refactor) — solo osservabilità, mai
  -- risolto a runtime dal rollback stesso.
  generation_job_id uuid REFERENCES generation_jobs(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_versions_app_id ON app_versions(app_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_versions_tenant_id ON app_versions(tenant_id);

ALTER TABLE app_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_versions_deny_anon_authenticated" ON app_versions;
CREATE POLICY "app_versions_deny_anon_authenticated" ON app_versions FOR ALL
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE app_versions IS 'Cronologia snapshot di apps.config per rollback — CreatorAI Engine 2.0, Fase 6. Vedi frontend/src/lib/app-versions.ts.';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
