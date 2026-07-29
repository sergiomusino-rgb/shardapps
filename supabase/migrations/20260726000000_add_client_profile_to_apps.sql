-- ============================================================================
-- ZeusX - Add client profile (buyer/titolare) columns to apps table
-- Data: 2026-07-26
-- Descrizione: Anagrafica dell'acquirente/titolare che usa l'app e paga
-- l'abbonamento, distinta dalle credenziali di login (client_email/password).
-- ============================================================================

ALTER TABLE apps
  ADD COLUMN IF NOT EXISTS client_full_name TEXT,
  ADD COLUMN IF NOT EXISTS client_phone TEXT,
  ADD COLUMN IF NOT EXISTS client_tax_id TEXT,
  ADD COLUMN IF NOT EXISTS client_billing_address TEXT,
  ADD COLUMN IF NOT EXISTS client_notes TEXT;

COMMENT ON COLUMN apps.client_full_name IS 'Nome e cognome o ragione sociale dell''acquirente/titolare dell''app';
COMMENT ON COLUMN apps.client_phone IS 'Telefono di contatto dell''acquirente/titolare';
COMMENT ON COLUMN apps.client_tax_id IS 'P.IVA o Codice Fiscale dell''acquirente/titolare';
COMMENT ON COLUMN apps.client_billing_address IS 'Indirizzo di fatturazione (testo libero) dell''acquirente/titolare';
COMMENT ON COLUMN apps.client_notes IS 'Note libere del reseller sull''acquirente/titolare dell''app';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
