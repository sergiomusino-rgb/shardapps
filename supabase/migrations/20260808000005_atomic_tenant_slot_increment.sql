-- ============================================================================
-- RPC: increment_tenant_app_count
-- Stesso pattern atomico di deduct_credits (vision_credits_schema.sql):
-- guardia nella WHERE della UPDATE, nessuna finestra tra lettura e scrittura.
-- Prima di questa RPC, la creazione app leggeva total_apps_created con una
-- SELECT separata e poi scriveva total_apps_created + 1 con una UPDATE
-- indipendente (frontend/app/api/creator/create/route.ts,
-- frontend/app/api/apps/route.ts): N richieste concorrenti sullo stesso
-- tenant leggevano tutte lo stesso valore, passavano tutte il controllo del
-- limite piano, e creavano N app per il prezzo di una. Ritorna NULL (nessuna
-- riga) se il tenant ha già raggiunto app_limit: il chiamante deve trattare
-- un risultato vuoto come "limite raggiunto", non creare comunque l'app.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.increment_tenant_app_count(
    p_tenant_id UUID
)
RETURNS TABLE (total_apps_created INTEGER, app_limit INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total INTEGER;
    v_limit INTEGER;
BEGIN
    UPDATE tenants
    SET total_apps_created = total_apps_created + 1, updated_at = now()
    WHERE id = p_tenant_id AND total_apps_created < app_limit
    RETURNING tenants.total_apps_created, tenants.app_limit INTO v_total, v_limit;

    IF NOT FOUND THEN
        RETURN; -- limite raggiunto (o tenant inesistente): nessuna riga, nessun incremento
    END IF;

    RETURN QUERY SELECT v_total, v_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_tenant_app_count(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_tenant_app_count(UUID) TO service_role;

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
