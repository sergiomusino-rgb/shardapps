-- ============================================================================
-- ZeusX - CreatorAI Fase 4: audit log per le azioni di entità
-- Data: 2026-08-13
-- ============================================================================
-- Log/audit trail per le azioni 'trigger_webhook'/'send_notification'
-- eseguite tramite backend/lib/action-dispatcher.js (POST .../records/
-- :recordId/actions/:actionId) — prima rispondevano 501, ora vengono
-- effettivamente dispatchate e registrate qui, con fallback a console log
-- strutturato se l'insert fallisce (la tabella potrebbe non esistere ancora
-- su un deploy che non ha applicato questa migration: additiva, non blocca
-- l'esecuzione dell'azione se assente).
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_action_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  record_id uuid,
  entity text NOT NULL,
  action_id text NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('change_state', 'trigger_webhook', 'send_notification')),
  status text NOT NULL DEFAULT 'dispatched' CHECK (status IN ('dispatched', 'delivered', 'failed')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_action_logs_app_id ON app_action_logs(app_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_action_logs_tenant_id ON app_action_logs(tenant_id);

ALTER TABLE app_action_logs ENABLE ROW LEVEL SECURITY;

-- Stesso pattern deny-all di app_credentials/app_rbac_users: nessun accesso
-- dalla Data API pubblica (anon/authenticated), solo backend Express con la
-- service_role key (bypassa RLS). Un futuro pannello "Log Azioni" lato
-- dashboard proprietario dovrà passare da una RPC SECURITY DEFINER dedicata
-- (stesso schema di get_app_client_credentials), non da accesso diretto.
CREATE POLICY "app_action_logs_deny_anon_authenticated" ON app_action_logs FOR ALL
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE app_action_logs IS 'Audit trail delle azioni di entità (change_state/trigger_webhook/send_notification) eseguite su un record — vedi backend/lib/action-dispatcher.js. Fase 4 CreatorAI.';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
