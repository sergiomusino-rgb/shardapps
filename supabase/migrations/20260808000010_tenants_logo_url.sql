-- ============================================================================
-- ZeusX - Motore "Comandi": logo aziendale del tenant
-- Data: 2026-08-08
-- Descrizione: aggiunge logo_url a tenants, per il logo caricato dal
-- titolare nella scheda Azienda (frontend/components/comandi/
-- ComandiInstanceDashboard.tsx, CompanyTab). Il file viene caricato nel
-- bucket pubblico esistente 'vision-uploads' (già usato da ZeusX Vision,
-- vedi 20260802000000_vision_credits_schema.sql) sotto {user_id}/..., non
-- serve un bucket dedicato: qui salviamo solo l'URL pubblico risultante.
-- ============================================================================

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_url TEXT;
COMMENT ON COLUMN tenants.logo_url IS 'URL pubblico del logo aziendale (bucket vision-uploads), opzionale — usato in Azienda e nei documenti fiscali';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
