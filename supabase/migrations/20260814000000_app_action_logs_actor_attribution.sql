-- ============================================================================
-- ZeusX - Security Audit Fase 4: attribution nel log azioni
-- Data: 2026-08-14
-- ============================================================================
-- app_action_logs (20260813000000) non aveva alcuna colonna che
-- identificasse CHI ha eseguito un'azione — solo "quale app". Un audit
-- trail senza attore ha utilità forense limitata: aggiunge actor_role e
-- actor_email, valorizzati da backend/lib/action-dispatcher.js a partire da
-- req.appUserRole/req.appUserEmail (backend/routes/client-app.js).
--
-- Additiva: colonne nullable, nessuna riga esistente invalidata. actor_email
-- resta NULL per le azioni eseguite su app non-rbac (legacy/supabase/
-- comandi_ai non hanno un concetto di utente individuale con email propria)
-- e per ogni riga scritta prima di questa migration.
-- ============================================================================

ALTER TABLE app_action_logs ADD COLUMN IF NOT EXISTS actor_role text;
ALTER TABLE app_action_logs ADD COLUMN IF NOT EXISTS actor_email text;

CREATE INDEX IF NOT EXISTS idx_app_action_logs_actor_email ON app_action_logs(actor_email) WHERE actor_email IS NOT NULL;

COMMENT ON COLUMN app_action_logs.actor_role IS 'Ruolo (admin/operator/viewer, o NULL per app senza concetto di ruolo) di chi ha eseguito l''azione — req.appUserRole al momento della chiamata.';
COMMENT ON COLUMN app_action_logs.actor_email IS 'Email dell''utente rbac che ha eseguito l''azione, NULL per app non-rbac o azioni precedenti a questa migration — req.appUserEmail al momento della chiamata.';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
