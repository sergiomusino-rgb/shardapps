-- ============================================================================
-- ZeusX - Transactions Table for Reseller Payments
-- Data: 2026-07-15
-- Descrizione: Tabella per tracciare le transazioni e le commissioni ZEUSX
-- ============================================================================

-- 1. TABELLA: transactions
-- Registra tutti i pagamenti e le commissioni ZEUSX
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_registry_id UUID REFERENCES app_registry(id) ON DELETE CASCADE,
    reseller_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL, -- subscription_payment_success, subscription_created, etc.
    event_id TEXT, -- ID evento LemonSqueezy
    total_amount DECIMAL(10, 2) NOT NULL, -- Importo totale pagato
    zeusx_commission DECIMAL(10, 2) NOT NULL, -- Commissione ZEUSX (50€ fissi)
    currency TEXT NOT NULL DEFAULT 'EUR',
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'pending', 'failed')),
    metadata JSONB, -- Dati aggiuntivi dall'evento
    created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE transactions IS 'Transazioni di pagamento e commissioni ZEUSX per rivenditori';
COMMENT ON COLUMN transactions.app_registry_id IS 'App associata alla transazione';
COMMENT ON COLUMN transactions.reseller_id IS 'Rivenditore che ha ricevuto il pagamento';
COMMENT ON COLUMN transactions.event_type IS 'Tipo di evento LemonSqueezy';
COMMENT ON COLUMN transactions.total_amount IS 'Importo totale pagato dal cliente';
COMMENT ON COLUMN transactions.zeusx_commission IS 'Commissione ZEUSX (50€ fissi)';

-- Indici per performance
CREATE INDEX IF NOT EXISTS idx_transactions_reseller_id ON transactions(reseller_id);
CREATE INDEX IF NOT EXISTS idx_transactions_event_type ON transactions(event_type);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);

-- 2. Aggiorna app_registry con expires_at, is_active e lemon_squeezy_product_id
ALTER TABLE app_registry 
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS lemon_squeezy_product_id TEXT;

COMMENT ON COLUMN app_registry.expires_at IS 'Data di scadenza dell''app';
COMMENT ON COLUMN app_registry.is_active IS 'Stato attivo dell''app';
COMMENT ON COLUMN app_registry.lemon_squeezy_product_id IS 'ID prodotto LemonSqueezy per il webhook';

-- 3. RLS per transactions
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Policy: i rivenditori vedono solo le loro transazioni
CREATE POLICY "Resellers view their own transactions" ON transactions
    FOR SELECT
    USING (reseller_id = auth.uid());

-- Policy per service role (amministrazione)
CREATE POLICY "Service role manages transactions" ON transactions
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================