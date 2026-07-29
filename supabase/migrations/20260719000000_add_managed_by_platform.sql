-- Aggiunge i campi per la gestione del takeover
-- Questi campi permettono a ZeusX di prendere in gestione un'app quando l'User abbandona

ALTER TABLE apps 
ADD COLUMN IF NOT EXISTS is_managed_by_platform BOOLEAN DEFAULT FALSE;

ALTER TABLE apps 
ADD COLUMN IF NOT EXISTS payment_reset_required BOOLEAN DEFAULT FALSE;

-- Aggiunge un commento per documentazione
COMMENT ON COLUMN apps.is_managed_by_platform IS 'Se TRUE, l''app è gestita direttamente da ZeusX (takeover) e non usa Stripe Connect';
COMMENT ON COLUMN apps.payment_reset_required IS 'Se TRUE, il cliente deve riattivare l''abbonamento sul nuovo sistema di gestione';

-- Index per performance sulle query di takeover
CREATE INDEX IF NOT EXISTS idx_apps_managed_by_platform ON apps(is_managed_by_platform);
CREATE INDEX IF NOT EXISTS idx_apps_payment_reset ON apps(payment_reset_required);
