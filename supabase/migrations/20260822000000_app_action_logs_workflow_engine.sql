-- ============================================================================
-- ZeusX - CreatorAI Engine 2.0, Fase 4: Application Logic / Workflow Engine
-- Data: 2026-08-22
-- ============================================================================
-- Estende app_action_logs (20260813000000 + 20260814000000) per l'audit
-- trail del nuovo event router (backend/lib/event-router.js):
--
-- 1. action_type: il CHECK esistente ammetteva solo change_state/
--    trigger_webhook/send_notification. Il nuovo Action Engine aggiunge
--    update_field e create_related_record (eseguiti da workflow, non da un
--    pulsante azione entità) — senza questa migration, il primo INSERT con
--    uno di questi due tipi violerebbe il CHECK esistente e fallirebbe.
-- 2. workflow_id: NULL per le azioni già esistenti (pulsante azione entità,
--    invariate) — valorizzato SOLO quando l'azione è stata eseguita da un
--    workflow del nuovo event router, per distinguere le due origini nello
--    stesso audit trail senza duplicarlo.
-- 3. event_type: quale evento (record.created/record.updated/record.deleted/
--    state.changed/user.action/schedule.tick/webhook.received) ha innescato
--    l'esecuzione — NULL per le azioni dirette (pulsante), invariate.
-- 4. retry_count: contatore di tentativi per l'azione — 0 per tutte le righe
--    esistenti e per le azioni sincrone dirette che non hanno mai retriato.
--    Fase 4 implementa solo retry sincrono/bounded (change_state/update_field/
--    create_related_record, vedi backend/lib/workflow-action-executor.js);
--    questa colonna prepara la struttura per un futuro consumer che riprovi
--    anche le righe status='failed' di trigger_webhook/send_notification
--    (oggi fire-and-forget, nessun retry) — non implementato in questa fase,
--    vedi report Fase 4.
--
-- Additiva al 100%: colonne nullable/con default, nessuna riga esistente
-- invalidata, nessuna policy RLS toccata (la deny-all esistente
-- "app_action_logs_deny_anon_authenticated" si applica automaticamente anche
-- alle nuove colonne, RLS è per riga non per colonna — vedi
-- backend/scripts/check_rls_policies.js, baseline invariata).
-- ============================================================================

ALTER TABLE app_action_logs DROP CONSTRAINT IF EXISTS app_action_logs_action_type_check;
ALTER TABLE app_action_logs ADD CONSTRAINT app_action_logs_action_type_check
  CHECK (action_type IN ('change_state', 'trigger_webhook', 'send_notification', 'update_field', 'create_related_record'));

ALTER TABLE app_action_logs ADD COLUMN IF NOT EXISTS workflow_id text;
ALTER TABLE app_action_logs ADD COLUMN IF NOT EXISTS event_type text;
ALTER TABLE app_action_logs ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_app_action_logs_workflow_id ON app_action_logs(workflow_id) WHERE workflow_id IS NOT NULL;

COMMENT ON COLUMN app_action_logs.workflow_id IS 'ID del workflow (AppSpecification.workflows[].id / SiteBlueprintJSON.workflows[].id) che ha innescato questa azione — NULL per le azioni dirette via pulsante entità (comportamento pre-Fase 4, invariato).';
COMMENT ON COLUMN app_action_logs.event_type IS 'Evento che ha innescato l''esecuzione (record.created|record.updated|record.deleted|state.changed|user.action|schedule.tick|webhook.received) — NULL per le azioni dirette via pulsante entità.';
COMMENT ON COLUMN app_action_logs.retry_count IS 'Numero di tentativi eseguiti per questa azione (Fase 4: solo retry sincrono/bounded su change_state/update_field/create_related_record) — 0 per ogni riga precedente a questa migration.';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
