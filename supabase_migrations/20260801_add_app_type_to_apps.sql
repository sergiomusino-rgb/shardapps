-- ============================================================================
-- ZeusX - app_type su apps (provisioning "Comandi AI" da slot)
-- Data: 2026-08-01
-- Descrizione: discriminatore fra le app a schema generato da AI (app_type
-- NULL, invariato) e i moduli a schema fisso provisionati da slot come
-- Comandi AI ('comandi_ai'). Usato da app/a/[slug]/layout.tsx e
-- app/a/[slug]/app/page.tsx per instradare verso la console operativa
-- dedicata invece del motore a tabelle dinamiche.
-- ============================================================================

ALTER TABLE apps ADD COLUMN IF NOT EXISTS app_type TEXT;
CREATE INDEX IF NOT EXISTS idx_apps_app_type ON apps(app_type);

COMMENT ON COLUMN apps.app_type IS 'NULL = app a schema generato da AI (Creator/Generator). ''comandi_ai'' = modulo Comandi provisionato da slot, schema fisso.';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
