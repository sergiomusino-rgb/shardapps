-- Migration: aggiungi colonne per accesso clienti
-- Aggiunge slug, password, email, stato attivo, scadenza e flag avviso alla tabella apps

ALTER TABLE apps ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS client_password TEXT;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS client_email TEXT;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS client_active BOOLEAN DEFAULT true;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS expiry_warning_sent BOOLEAN DEFAULT false;
