-- ============================================================================
-- ZeusX - Add initial_password column to apps table
-- Data: 2026-07-24
-- Descrizione: Aggiunge il campo initial_password per le credenziali cliente
-- ============================================================================

-- Aggiungi colonna initial_password (password temporanea iniziale)
ALTER TABLE apps 
ADD COLUMN IF NOT EXISTS initial_password TEXT;

-- Commento di documentazione
COMMENT ON COLUMN apps.initial_password IS 'Password temporanea iniziale generata alla creazione dell''app per l''accesso cliente';

-- Indice per performance (se necessario per ricerche)
CREATE INDEX IF NOT EXISTS idx_apps_initial_password ON apps(initial_password);

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================