-- ============================================================================
-- ZeusX - Motore "Comandi": Codice Destinatario SDI su clienti e fatture
-- Data: 2026-08-08
-- Descrizione: aggiunge il Codice Destinatario (SDI) per la fatturazione
-- elettronica, sia in anagrafica clienti (precompilazione) sia sulla
-- singola fattura (snapshot al momento dell'emissione, indipendente da
-- modifiche successive all'anagrafica — stessa logica già in uso per
-- cliente_nome/cliente_piva su fatture).
-- ============================================================================

ALTER TABLE customers ADD COLUMN IF NOT EXISTS sdi_code TEXT;
COMMENT ON COLUMN customers.sdi_code IS 'Codice Destinatario SDI per la fatturazione elettronica, opzionale';

ALTER TABLE fatture ADD COLUMN IF NOT EXISTS cliente_sdi TEXT;
COMMENT ON COLUMN fatture.cliente_sdi IS 'Codice Destinatario SDI del cliente al momento dell''emissione, opzionale';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
