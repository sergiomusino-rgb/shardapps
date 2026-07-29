-- ============================================================================
-- ZeusX - Add auth_mode column to apps table
-- Data: 2026-07-25
-- Descrizione: Discriminatore tra il vecchio accesso cliente a password in
-- chiaro ('legacy', invariato per le app esistenti) e il nuovo flusso
-- Landing -> Login/Register -> Dashboard basato su Supabase Auth ('supabase'),
-- usato da ora in poi per ogni nuova app generata dal Creator AI.
-- ============================================================================

ALTER TABLE apps
ADD COLUMN IF NOT EXISTS auth_mode TEXT NOT NULL DEFAULT 'legacy'
  CHECK (auth_mode IN ('legacy', 'supabase'));

CREATE INDEX IF NOT EXISTS idx_apps_auth_mode ON apps(auth_mode);

COMMENT ON COLUMN apps.auth_mode IS 'legacy = accesso cliente a password condivisa (app esistenti); supabase = login/registrazione reali via Supabase Auth + app_users (nuove app)';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
