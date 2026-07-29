-- ============================================================================
-- ZeusX - App Registry per Management Console
-- Data: 2026-07-14
-- Descrizione: Tabella per tracciare le app create dai rivenditori con dati di fatturazione
-- ============================================================================

-- ============================================================================
-- 1. TABELLA: app_registry
-- ============================================================================
CREATE TABLE IF NOT EXISTS app_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reseller_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    app_name TEXT NOT NULL,
    app_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'pending')),
    monthly_fee DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    zeusx_share DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE app_registry IS 'Registry delle app registrate dai rivenditori per la Management Console. Traccia fatturazione e percentuali ZEUSX.';
COMMENT ON COLUMN app_registry.reseller_id IS 'Riferimento all''utente rivenditore (auth.users)';
COMMENT ON COLUMN app_registry.app_name IS 'Nome dell''app registrata';
COMMENT ON COLUMN app_registry.app_url IS 'URL pubblico dell''app (/a/:slug)';
COMMENT ON COLUMN app_registry.status IS 'Stato dell''app: active, suspended, pending';
COMMENT ON COLUMN app_registry.monthly_fee IS 'Quota mensile dell''app in EUR';
COMMENT ON COLUMN app_registry.zeusx_share IS 'Percentuale ZEUSX sulla quota mensile (es. 25.00 = 25%)';

-- Trigger updated_at
DROP TRIGGER IF EXISTS tr_app_registry_updated_at ON app_registry;
CREATE TRIGGER tr_app_registry_updated_at
    BEFORE UPDATE ON app_registry
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Indici per performance
CREATE INDEX IF NOT EXISTS idx_app_registry_reseller_id ON app_registry(reseller_id);
CREATE INDEX IF NOT EXISTS idx_app_registry_status ON app_registry(status);
CREATE INDEX IF NOT EXISTS idx_app_registry_reseller_status ON app_registry(reseller_id, status);

-- ============================================================================
-- 2. FUNZIONE: get_reseller_apps
-- Estrae l'elenco delle app per un reseller_id specifico
-- ============================================================================
CREATE OR REPLACE FUNCTION get_reseller_apps(p_reseller_id UUID)
RETURNS TABLE (
    id UUID,
    app_name TEXT,
    app_url TEXT,
    status TEXT,
    monthly_fee DECIMAL(10, 2),
    zeusx_share DECIMAL(10, 2),
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ar.id,
        ar.app_name,
        ar.app_url,
        ar.status,
        ar.monthly_fee,
        ar.zeusx_share,
        ar.created_at
    FROM app_registry ar
    WHERE ar.reseller_id = p_reseller_id
    ORDER BY ar.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_reseller_apps IS 'Restituisce l''elenco delle app per un rivenditore specifico';

-- ============================================================================
-- 3. FUNZIONE: get_zeusx_total_due
-- Calcola il totale dovuto a ZEUSX sommando zeusx_share di tutte le app attive
-- ============================================================================
CREATE OR REPLACE FUNCTION get_zeusx_total_due(p_reseller_id UUID)
RETURNS DECIMAL(10, 2) AS $$
DECLARE
    total DECIMAL(10, 2) := 0.00;
BEGIN
    SELECT COALESCE(SUM(zeusx_share), 0.00)
    INTO total
    FROM app_registry
    WHERE reseller_id = p_reseller_id 
      AND status = 'active';
    
    RETURN total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_zeusx_total_due IS 'Calcola il totale dovuto a ZEUSX sommando le percentuali di tutte le app attive per un rivenditore';

-- ============================================================================
-- 4. FUNZIONE: get_reseller_apps_with_total
-- Vista combinata: elenco app + totale zeusx_share in un'unica chiamata
-- ============================================================================
CREATE OR REPLACE FUNCTION get_reseller_apps_with_total(p_reseller_id UUID)
RETURNS TABLE (
    id UUID,
    app_name TEXT,
    app_url TEXT,
    status TEXT,
    monthly_fee DECIMAL(10, 2),
    zeusx_share DECIMAL(10, 2),
    created_at TIMESTAMPTZ,
    total_zeusx_due DECIMAL(10, 2)
) AS $$
DECLARE
    v_total DECIMAL(10, 2) := 0.00;
BEGIN
    -- Calcola prima il totale
    SELECT get_zeusx_total_due(p_reseller_id) INTO v_total;
    
    -- Restituisce le app con il totale in ogni riga
    RETURN QUERY
    SELECT 
        ar.id,
        ar.app_name,
        ar.app_url,
        ar.status,
        ar.monthly_fee,
        ar.zeusx_share,
        ar.created_at,
        v_total as total_zeusx_due
    FROM app_registry ar
    WHERE ar.reseller_id = p_reseller_id
    ORDER BY ar.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_reseller_apps_with_total IS 'Restituisce le app del rivenditore con il totale ZEUSX dovuto incluso';

-- ============================================================================
-- 5. ROW LEVEL SECURITY (RLS)
-- ============================================================================
ALTER TABLE app_registry ENABLE ROW LEVEL SECURITY;

-- Policy: i rivenditori vedono solo le loro app
DROP POLICY IF EXISTS "Resellers view their own apps" ON app_registry;
CREATE POLICY "Resellers view their own apps" ON app_registry
    FOR SELECT
    USING (reseller_id = auth.uid());

DROP POLICY IF EXISTS "Resellers manage their own apps" ON app_registry;
CREATE POLICY "Resellers manage their own apps" ON app_registry
    FOR ALL
    USING (reseller_id = auth.uid())
    WITH CHECK (reseller_id = auth.uid());

-- Policy per service role (amministrazione)
DROP POLICY IF EXISTS "Service role manages app_registry" ON app_registry;
CREATE POLICY "Service role manages app_registry" ON app_registry
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================