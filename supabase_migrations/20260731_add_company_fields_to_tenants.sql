-- ============================================================================
-- ZeusX - Dati anagrafici azienda su tenants (onboarding Comandi)
-- Data: 2026-07-31
-- Descrizione: lo Step 2 del decoupling di Comandi ("Setup dati aziendali")
-- richiede di salvare P.IVA/indirizzo/telefono dell'azienda. La tabella
-- tenants non ha colonne per questi dati (company_settings esiste già ma è
-- agganciata ad app_id, non tenant_id, quindi non riusabile qui). Aggiungiamo
-- colonne nullable a tenants: nessun impatto sulle righe esistenti o su
-- codice che già seleziona/aggiorna tenants.
-- ============================================================================

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS vat_number TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS phone TEXT;

COMMENT ON COLUMN tenants.vat_number IS 'Partita IVA o Codice Fiscale dell''azienda';
COMMENT ON COLUMN tenants.address IS 'Indirizzo sede dell''azienda';
COMMENT ON COLUMN tenants.city IS 'Città sede dell''azienda';
COMMENT ON COLUMN tenants.phone IS 'Telefono/contatto dell''azienda';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
