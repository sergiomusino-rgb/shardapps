-- ============================================================================
-- Fix: increment_tenant_app_count - colonna ambigua (mai funzionante)
-- Data: 2026-08-09
-- Descrizione: la funzione (20260808000005_atomic_tenant_slot_increment.sql)
-- dichiara RETURNS TABLE (total_apps_created INTEGER, app_limit INTEGER),
-- che in plpgsql introduce due parametri OUT con lo stesso nome delle colonne
-- di tenants. Il corpo della UPDATE referenzia total_apps_created/app_limit
-- senza qualificarli con l'alias tabella: Postgres non sa se intende la
-- colonna o il parametro OUT -> errore 42702 "column reference is ambiguous"
-- ad ogni chiamata, da quando la funzione e' stata creata.
--
-- Impatto reale: i chiamanti (api/creator/create/route.ts, api/apps/route.ts)
-- trattano solo PGRST202/42883 ("funzione non esiste") come "migration non
-- ancora applicata, fallback al vecchio comportamento non atomico" — 42702
-- non rientra in quel caso, quindi la richiesta fallisce con 500
-- SLOTS_CHECK_ERROR invece di usare il fallback o l'incremento atomico.
-- api/creator/publish/route.ts (motore attivo per gli utenti normali) non
-- chiama questa RPC, quindi non e' l'unico gate di creazione app: bug isolato
-- a create/route.ts e api/apps/route.ts, non ha mai bloccato /dashboard/creator.
--
-- Fix: qualifica esplicitamente ogni riferimento a colonna con l'alias
-- tabella "t" nella UPDATE, nessun'altra modifica alla logica/firma.
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
    UPDATE tenants AS t
    SET total_apps_created = t.total_apps_created + 1, updated_at = now()
    WHERE t.id = p_tenant_id AND t.total_apps_created < t.app_limit
    RETURNING t.total_apps_created, t.app_limit INTO v_total, v_limit;

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
