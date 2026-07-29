-- ============================================================================
-- ZeusX - Milestone 1: Aggiunta campi per gestione pagamenti multi-tenant
-- Data: 2026-07-18
-- Descrizione: Aggiunge campi necessari per Stripe Managed Payments (Merchant of Record)
-- ============================================================================

-- ============================================================================
-- 1. Aggiungi colonna stripe_connect_id
-- L'account Stripe connesso dell'User proprietario
-- ============================================================================
ALTER TABLE apps 
ADD COLUMN IF NOT EXISTS stripe_connect_id TEXT;

-- ============================================================================
-- 2. Aggiungi colonna client_subscription_price
-- Il prezzo dell'abbonamento che l'User imposta per i suoi clienti finali
-- ============================================================================
ALTER TABLE apps 
ADD COLUMN IF NOT EXISTS client_subscription_price NUMERIC(10, 2) DEFAULT 0.00;

-- ============================================================================
-- 3. Aggiungi colonna totalum_app_id
-- L'ID dell'applicazione generata tramite l'API di Totalum
-- ============================================================================
ALTER TABLE apps 
ADD COLUMN IF NOT EXISTS totalum_app_id TEXT;

-- ============================================================================
-- 4. Aggiungi colonna status
-- Stato dell'app: trial, active, expired
-- Nota: la tabella ha già is_active (boolean), ma status fornisce
-- uno stato più dettagliato con le tre fasi richieste
-- ============================================================================
ALTER TABLE apps 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'trial' CHECK (status IN ('trial', 'active', 'expired'));

-- ============================================================================
-- 5. Aggiorna trial_ends_at per assicurare il default corretto
-- La data di scadenza della prova: NOW() + INTERVAL '30 days'
-- Nota: la colonna esiste già, ma riconsideriamo il default per chiarezza
-- ============================================================================
-- La colonna trial_ends_at esiste già con default, ma se necessario si può
-- aggiungere un commento per documentazione
COMMENT ON COLUMN apps.trial_ends_at IS 'Data di scadenza del periodo di prova (30 giorni di default)';

-- ============================================================================
-- 6. Indici per performance
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_apps_stripe_connect_id ON apps(stripe_connect_id);
CREATE INDEX IF NOT EXISTS idx_apps_status ON apps(status);
CREATE INDEX IF NOT EXISTS idx_apps_totalum_app_id ON apps(totalum_app_id);

-- ============================================================================
-- 7. Commenti di documentazione
-- ============================================================================
COMMENT ON COLUMN apps.stripe_connect_id IS 'ID dell''account Stripe Connect del proprietario dell''app (Merchant of Record)';
COMMENT ON COLUMN apps.client_subscription_price IS 'Prezzo mensile dell''abbonamento per i clienti finali in EUR';
COMMENT ON COLUMN apps.totalum_app_id IS 'ID dell''app generata tramite l''API di Totalum';
COMMENT ON COLUMN apps.status IS 'Stato dell''app: trial (prova), active (attiva), expired (scaduta)';

-- ============================================================================
-- 8. Funzione per aggiornare automaticamente lo stato in base a trial_ends_at
-- ============================================================================
CREATE OR REPLACE FUNCTION update_app_status()
RETURNS TRIGGER AS $$
BEGIN
  -- Se l'app è in trial e la data è scaduta, imposta lo stato su 'expired'
  IF NEW.status = 'trial' AND NEW.trial_ends_at < NOW() THEN
    NEW.status = 'expired';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger per eseguire il controllo su ogni update
DROP TRIGGER IF EXISTS tr_apps_status_check ON apps;
CREATE TRIGGER tr_apps_status_check 
  BEFORE UPDATE ON apps 
  FOR EACH ROW 
  EXECUTE FUNCTION update_app_status();

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================