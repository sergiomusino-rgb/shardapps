-- ============================================================================
-- ShardApps - Rimozione placeholder LemonSqueezy da admin_takeover_reseller_app
-- Data: 2026-08-21
-- ============================================================================
-- Cleanup pre-lancio (ZERO DEBT), non un fix funzionale: admin_takeover_
-- reseller_app (migration 20260716000000_admin_takeover_function.sql) scrive
-- un URL placeholder hardcoded 'https://zeusx.lemonsqueezy.com/checkout/
-- master-product-placeholder' in app_registry.checkout_url ad ogni takeover.
-- LemonSqueezy è stato rimosso dalla piattaforma (vedi PR #9, "Sicurezza:
-- LemonSqueezy, RLS/permessi funzioni, billing Stripe") — questo era l'unico
-- residuo di codice VIVO rimasto (non un commento o una colonna storica):
-- una stringa con un dominio LemonSqueezy realmente scritta su una riga a
-- ogni chiamata della funzione.
--
-- Verificato prima di questa migration che sia sicuro toccarla:
-- - admin_takeover_reseller_app NON è mai chiamata da alcuna route viva
--   (grep su frontend/app/api, backend/routes, backend/lib: zero risultati
--   per `.rpc('admin_takeover_reseller_app'` o `.rpc('get_app_for_takeover'`).
--   L'endpoint attualmente in uso (frontend/app/api/admin/takeover/route.ts)
--   implementa il takeover con un UPDATE diretto su `apps`
--   (is_managed_by_platform/payment_reset_required) e non tocca mai
--   `app_registry`/checkout_url: questa RPC è codice morto lato applicativo,
--   ma resta raggiungibile via RPC diretta (solo da service_role, vedi
--   FUNCTION_BASELINE in backend/scripts/check_rls_policies.js) finché
--   esiste nello schema.
-- - app_registry.checkout_url non è mai letto/mostrato in alcuna pagina o
--   risposta API rivolta a un utente reale (solo in
--   frontend/app/api/admin/stats/route.ts, un endpoint statistiche admin che
--   lo espone così com'è, mai renderizzato come link cliccabile).
--
-- Cosa NON cambia in questa migration:
-- - NON tocca la migration storica 20260716000000 (resta intatta, i suoi
--   commenti "URL checkout LemonSqueezy" restano come nota storica di dove
--   nasce la colonna checkout_url).
-- - NON tocca 20260715000001_transactions_table.sql (colonna
--   app_registry.lemon_squeezy_product_id, commenti su transactions.event_id/
--   event_type): colonne storiche dello schema, mai scritte da codice vivo
--   (LemonSqueezy rimosso), non richiesto rimuoverle e farlo richiederebbe
--   un DROP COLUMN esplicitamente escluso da questo cleanup.
-- - NON tocca alcuna funzione SQL usata da Stripe (webhook, sync-plan,
--   crediti, ecc.) — CREATE OR REPLACE su una firma identica preserva GRANT/
--   REVOKE esistenti (verificato: gli stessi identici grant di
--   FUNCTION_BASELINE restano validi, nessun cambiamento ai permessi).
-- - NON cambia il comportamento operativo di admin_takeover_reseller_app:
--   stessa firma, stesso corpo, stessa logica — SOLO il valore del
--   placeholder passa da un URL LemonSqueezy fittizio a NULL, dato che non
--   esiste un "master checkout URL" reale nel modello Stripe Connect attuale
--   (un fake ShardApps al posto di un fake LemonSqueezy non sarebbe
--   comunque un dato corretto da scrivere).
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
    -- Prima: 'https://zeusx.lemonsqueezy.com/checkout/master-product-placeholder'
    -- (residuo LemonSqueezy, mai un URL reale). Nessun equivalente esiste nel
    -- modello Stripe Connect attuale (il checkout per-app è generato da
    -- frontend/app/api/apps/checkout/route.ts, non da un "master checkout"
    -- unico) — NULL è il valore corretto, non un altro placeholder fittizio.
    v_master_checkout_url TEXT := NULL;
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

COMMENT ON FUNCTION admin_takeover_reseller_app IS 'Funzione di emergenza per prendere il controllo completo di un app rivenduta. Non chiamata da alcuna route viva (vedi frontend/app/api/admin/takeover/route.ts per il flusso attualmente in uso) — mantenuta per compatibilità, placeholder LemonSqueezy rimosso il 2026-08-21.';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
