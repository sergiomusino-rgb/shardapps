-- ============================================================================
-- ZeusX - Motore "Comandi": nome visualizzato per i membri del tenant
-- Data: 2026-08-08
-- Descrizione: aggiunge una colonna display_name a tenant_members, usata
-- principalmente dalla nuova pagina "Agenti" (gestione rappresentanti sul
-- campo con accesso ridotto, ruolo 'agent' — vedi 20260803000000) per
-- mostrare un nome leggibile invece della sola email dell'account Supabase
-- Auth associato. Opzionale e generica: non limitata al ruolo 'agent'.
-- ============================================================================

ALTER TABLE tenant_members ADD COLUMN IF NOT EXISTS display_name TEXT;

COMMENT ON COLUMN tenant_members.display_name IS 'Nome leggibile del membro (es. nome dell''agente), opzionale — usato in UI al posto della sola email';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
