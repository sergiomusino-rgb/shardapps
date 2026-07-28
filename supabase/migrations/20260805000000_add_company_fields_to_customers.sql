-- ============================================================================
-- ZeusX - Motore "Comandi": scheda cliente completa (pagina Clienti)
-- Data: 2026-08-05
-- Descrizione: allinea la rubrica clienti ai campi già usati per l'anagrafica
-- azienda del tenant (vedi 20260731000000_add_company_fields_to_tenants.sql:
-- vat_number, address, city, phone), più email, per poter compilare una
-- scheda cliente completa dalla nuova pagina "Clienti" e non solo il minimo
-- nome/telefono raccolto finora dal selettore rapido in app/agente.
-- ============================================================================

ALTER TABLE customers ADD COLUMN IF NOT EXISTS vat_number TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email TEXT;

COMMENT ON COLUMN customers.vat_number IS 'Partita IVA o Codice Fiscale del cliente';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
