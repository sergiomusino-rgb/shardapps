-- Migration: Aggiungi colonne mancanti alla tabella apps
-- Data: 2026-06-29
-- Descrizione: Aggiunge colonne necessarie per il funzionamento dell'applicazione

-- Aggiungi colonna slug (identificativo unico per l'app)
ALTER TABLE apps ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;

-- Aggiungi colonna password cliente
ALTER TABLE apps ADD COLUMN IF NOT EXISTS client_password TEXT;

-- Aggiungi colonna email cliente
ALTER TABLE apps ADD COLUMN IF NOT EXISTS client_email TEXT;

-- Aggiungi colonna per attivazione cliente
ALTER TABLE apps ADD COLUMN IF NOT EXISTS client_active BOOLEAN NOT NULL DEFAULT true;

-- Aggiungi colonna data di scadenza
ALTER TABLE apps ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Aggiungi colonna per tracciare se è stata inviata l'avviso di scadenza
ALTER TABLE apps ADD COLUMN IF NOT EXISTS expiry_warning_sent BOOLEAN NOT NULL DEFAULT false;

-- Aggiungi colonna is_active se non esiste (dovrebbe già esserci ma la garantiamo)
ALTER TABLE apps ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Indici per performance sulle nuove colonne
CREATE INDEX IF NOT EXISTS idx_apps_slug ON apps(slug);
CREATE INDEX IF NOT EXISTS idx_apps_client_email ON apps(client_email);
CREATE INDEX IF NOT EXISTS idx_apps_expires_at ON apps(expires_at);

-- Commenti documentazione
COMMENT ON COLUMN apps.slug IS 'Identificativo unico leggibile per l''app (usato negli URL pubblici)';
COMMENT ON COLUMN apps.client_password IS 'Password per accesso clienti all''app pubblica';
COMMENT ON COLUMN apps.client_email IS 'Email del cliente principale dell''app';
COMMENT ON COLUMN apps.client_active IS 'Se true, l''app è attiva per i clienti';
COMMENT ON COLUMN apps.expires_at IS 'Data di scadenza dell''abbonamento';
COMMENT ON COLUMN apps.expiry_warning_sent IS 'Se true, è già stata inviata l''email di avviso scadenza';