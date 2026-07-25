-- ============================================================================
-- ZeusX - Milestone 2: Aggiornamento tabella apps per Reseller/White-label checkout
-- Data: 2026-07-23
-- Descrizione: Aggiunge campi per gestione prova e prezzi singole app con Stripe Connect
-- ============================================================================

-- ============================================================================
-- 1. Rinomina e aggiungi campi per trial
-- ============================================================================

-- Aggiungi trial_start (default now())
ALTER TABLE apps 
ADD COLUMN IF NOT EXISTS trial_start TIMESTAMPTZ DEFAULT now();

-- Rinomina trial_ends_at in trial_end (più chiaro) e aggiungi default
-- Nota: manteniamo trial_ends_at per compatibilità, aggiungiamo trial_end
ALTER TABLE apps 
ADD COLUMN IF NOT EXISTS trial_end TIMESTAMPTZ DEFAULT (now() + INTERVAL '30 days');

-- ============================================================================
-- 2. Aggiungi stripe_subscription_id per la singola app
-- L'abbonamento Stripe legato alla singola app (non al tenant)
-- ============================================================================
ALTER TABLE apps 
ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

-- ============================================================================
-- 3. Aggiungi client_price (prezzo totale impostato dal reseller)
-- Rinomina client_subscription_price in client_price per chiarezza
-- ============================================================================
ALTER TABLE apps 
ADD COLUMN IF NOT EXISTS client_price NUMERIC(10, 2) DEFAULT 25.00;

-- ============================================================================
-- 4. Aggiungi zeusx_fee (quota fissa mensile 25€)
-- La quota fissa che spetta sempre a ZeusX
-- ============================================================================
ALTER TABLE apps 
ADD COLUMN IF NOT EXISTS zeusx_fee NUMERIC(10, 2) DEFAULT 25.00;

-- ============================================================================
-- 5. Aggiorna status con nuovi valori
-- Valori: 'trial', 'active', 'past_due', 'canceled'
-- ============================================================================
-- Prima rimuoviamo il constraint esistente
ALTER TABLE apps DROP CONSTRAINT IF EXISTS apps_status_check;

-- Poi aggiungiamo il nuovo constraint
ALTER TABLE apps 
ADD CONSTRAINT apps_status_check 
CHECK (status IN ('trial', 'active', 'past_due', 'canceled'));

-- ============================================================================
-- 6. Indici per performance
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_apps_stripe_subscription_id ON apps(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_apps_trial_start ON apps(trial_start);
CREATE INDEX IF NOT EXISTS idx_apps_trial_end ON apps(trial_end);
CREATE INDEX IF NOT EXISTS idx_apps_client_price ON apps(client_price);

-- ============================================================================
-- 7. Commenti di documentazione
-- ============================================================================
COMMENT ON COLUMN apps.trial_start IS 'Data di inizio del periodo di prova (default: now())';
COMMENT ON COLUMN apps.trial_end IS 'Data di fine del periodo di prova (default: 30 giorni dopo trial_start)';
COMMENT ON COLUMN apps.stripe_subscription_id IS 'ID dell''abbonamento Stripe legato alla singola app';
COMMENT ON COLUMN apps.client_price IS 'Prezzo mensile totale impostato dal reseller per i clienti finali in EUR';
COMMENT ON COLUMN apps.zeusx_fee IS 'Quota fissa mensile di ZeusX (25.00 EUR)';
COMMENT ON COLUMN apps.status IS 'Stato dell''app: trial (prova), active (attiva), past_due (pagamento scaduto), canceled (cancellata)';

-- ============================================================================
-- 8. Funzione per aggiornare automaticamente trial_end quando trial_start cambia
-- ============================================================================
CREATE OR REPLACE FUNCTION update_trial_end()
RETURNS TRIGGER AS $$
BEGIN
  -- Se trial_start viene impostato e trial_end è null, imposta trial_end a 30 giorni dopo
  IF NEW.trial_start IS NOT NULL AND NEW.trial_end IS NULL THEN
    NEW.trial_end = NEW.trial_start + INTERVAL '30 days';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger per eseguire il controllo su ogni insert/update
DROP TRIGGER IF EXISTS tr_apps_trial_end ON apps;
CREATE TRIGGER tr_apps_trial_end 
  BEFORE INSERT OR UPDATE ON apps 
  FOR EACH ROW 
  EXECUTE FUNCTION update_trial_end();

-- ============================================================================
-- 9. Migrazione dati: popola i nuovi campi dalle colonne esistenti
-- ============================================================================
-- Copia trial_ends_at in trial_end se non è già valorizzato
UPDATE apps 
SET trial_end = trial_ends_at,
    trial_start = created_at
WHERE trial_end IS NULL AND trial_ends_at IS NOT NULL;

-- Copia client_subscription_price in client_price se non è già valorizzato
UPDATE apps 
SET client_price = client_subscription_price
WHERE client_price IS NULL AND client_subscription_price IS NOT NULL;

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================