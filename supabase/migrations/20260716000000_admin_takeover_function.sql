-- ============================================================================
-- ZeusX - Admin Takeover Function
-- Data: 2026-07-16
-- Descrizione: Funzione di emergenza per prendere il controllo di un'app rivenduta
-- ============================================================================

-- ============================================================================
-- 1. AGGIORNA SCHEMA app_registry
-- Aggiungi colonne necessarie per il takeover
-- ============================================================================

ALTER TABLE app_registry 
ADD COLUMN IF NOT EXISTS ownership_status TEXT NOT NULL DEFAULT 'reseller_owned' 
    CHECK (ownership_status IN ('reseller_owned', 'admin_owned')),
ADD COLUMN IF NOT EXISTS checkout_url TEXT,
ADD COLUMN IF NOT EXISTS original_reseller_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN app_registry.ownership_status IS 'Stato di proprietà: reseller_owned o admin_owned';
COMMENT ON COLUMN app_registry.checkout_url IS 'URL checkout LemonSqueezy per il rivenditore';
COMMENT ON COLUMN app_registry.original_reseller_id IS 'Rivenditore originale (preservato dopo takeover)';

-- ============================================================================
-- 2. FUNZIONE: admin_takeover_reseller_app
-- Esegue il takeover completo di un'app
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_takeover_reseller_app(target_app_id UUID)
RETURNS TABLE (
    success BOOLEAN,
    message TEXT,
    app_name TEXT,
    original_reseller_id UUID,
    new_checkout_url TEXT
) AS $$
DECLARE
    v_app_name TEXT;
    v_original_reseller UUID;
    v_user_email TEXT;
    v_master_checkout_url TEXT := 'https://zeusx.lemonsqueezy.com/checkout/master-product-placeholder';
BEGIN
    -- Verifica che l'app esista
    SELECT ar.app_name, ar.reseller_id, u.email
    INTO v_app_name, v_original_reseller, v_user_email
    FROM app_registry ar
    LEFT JOIN auth.users u ON ar.reseller_id = u.id
    WHERE ar.id = target_app_id;
    
    IF NOT FOUND THEN
        RETURN QUERY SELECT 
            false as success,
            'App non trovata' as message,
            NULL::TEXT as app_name,
            NULL::UUID as original_reseller_id,
            NULL::TEXT as new_checkout_url;
        RETURN;
    END IF;
    
    -- Aggiorna lo stato di proprietà e preserva il rivenditore originale
    UPDATE app_registry
    SET 
        ownership_status = 'admin_owned',
        checkout_url = v_master_checkout_url,
        original_reseller_id = reseller_id,
        reseller_id = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5'::UUID  -- Admin user ID
    WHERE id = target_app_id;
    
    -- Segna le future commissioni per l'account admin
    -- (le transazioni future useranno il reseller_id admin)
    
    RETURN QUERY SELECT 
        true as success,
        'Takeover completato con successo' as message,
        v_app_name as app_name,
        v_original_reseller as original_reseller_id,
        v_master_checkout_url as new_checkout_url;
        
EXCEPTION
    WHEN OTHERS THEN
        RETURN QUERY SELECT 
            false as success,
            'Errore: ' || SQLERRM as message,
            NULL::TEXT as app_name,
            NULL::UUID as original_reseller_id,
            NULL::TEXT as new_checkout_url;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION admin_takeover_reseller_app IS 'Funzione di emergenza per prendere il controllo completo di un app rivenduta';

-- ============================================================================
-- 3. FUNZIONE: get_app_for_takeover
-- Recupera i dati necessari per la conferma del takeover
-- ============================================================================

CREATE OR REPLACE FUNCTION get_app_for_takeover(target_app_id UUID)
RETURNS TABLE (
    id UUID,
    app_name TEXT,
    app_url TEXT,
    reseller_id UUID,
    reseller_email TEXT,
    ownership_status TEXT,
    checkout_url TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ar.id,
        ar.app_name,
        ar.app_url,
        ar.reseller_id,
        u.email as reseller_email,
        ar.ownership_status,
        ar.checkout_url
    FROM app_registry ar
    LEFT JOIN auth.users u ON ar.reseller_id = u.id
    WHERE ar.id = target_app_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_app_for_takeover IS 'Recupera i dati di un app per la conferma del takeover';

-- ============================================================================
-- 4. AGGIORNA RLS POLICY per resilienza
-- I rivenditori non possono più accedere alle app admin_owned
-- ============================================================================

-- Rimuovi e ricrea la policy per la visualizzazione
DROP POLICY IF EXISTS "Resellers view their own apps" ON app_registry;
CREATE POLICY "Resellers view their own apps" ON app_registry
    FOR SELECT
    USING (
        reseller_id = auth.uid() 
        AND ownership_status = 'reseller_owned'
    );

-- Rimuovi e ricrea la policy per la gestione (INSERT/UPDATE/DELETE)
DROP POLICY IF EXISTS "Resellers manage their own apps" ON app_registry;
CREATE POLICY "Resellers manage their own apps" ON app_registry
    FOR ALL
    USING (
        reseller_id = auth.uid() 
        AND ownership_status = 'reseller_owned'
    )
    WITH CHECK (
        reseller_id = auth.uid() 
        AND ownership_status = 'reseller_owned'
    );

-- Policy per service role (amministrazione) - mantiene accesso completo
DROP POLICY IF EXISTS "Service role manages app_registry" ON app_registry;
CREATE POLICY "Service role manages app_registry" ON app_registry
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================