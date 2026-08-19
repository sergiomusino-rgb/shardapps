-- ============================================================================
-- ShardApps - Fix: increment_tenant_app_count, colonna ambigua reintrodotta
-- Data: 2026-08-30 (immediatamente dopo 20260830000000)
-- ============================================================================
-- 20260830000000_private_beta_entitlement.sql ha riscritto
-- increment_tenant_app_count per aggiungere il bypass beta_access, ma il
-- CREATE OR REPLACE è stato scritto a partire dalla versione ORIGINALE
-- (20260808000005_atomic_tenant_slot_increment.sql), non da quella già
-- corretta il giorno dopo (20260809000002_fix_increment_tenant_app_count_
-- ambiguous_column.sql): ha quindi sovrascritto la fix e reintrodotto lo
-- stesso identico bug Postgres 42702 "column reference is ambiguous".
--
-- Causa (invariata rispetto al 2026-08-09): RETURNS TABLE (total_apps_created
-- INTEGER, app_limit INTEGER) introduce due parametri OUT con lo stesso nome
-- delle colonne di tenants — ogni riferimento non qualificato nel corpo della
-- funzione (SET/WHERE) diventa ambiguo per Postgres.
--
-- Impatto reale (diagnosticato in produzione dopo il deploy di
-- 20260830000000): ogni chiamata alla RPC falliva con 42702, non solo per i
-- tenant beta — increment_tenant_app_count è la stessa RPC atomica condivisa
-- da /api/creator/publish e /api/catalog/products/[productSlug]/provision per
-- QUALUNQUE tenant alla prima pubblicazione di un'app. Il fallback non
-- atomico di reserveAppSlot (src/lib/creator-server.ts) gestisce solo
-- PGRST202/42883 ("funzione non esiste"), non 42702: nessun degrado
-- automatico, la richiesta falliva con 500 SLOTS_CHECK_ERROR.
--
-- Fix: stesso pattern già verificato in 20260809000002 (alias tabella "t",
-- ogni colonna qualificata sia in SET che in WHERE che in RETURNING), con
-- l'unica differenza rispetto a quella versione: la clausola aggiuntiva
-- "OR t.beta_access = true" introdotta da 20260830000000, anch'essa
-- qualificata con l'alias. Nessun'altra modifica — firma, RETURNS TABLE,
-- SECURITY DEFINER, search_path e grants (già ristretti a service_role,
-- invariati da questa migration: CREATE OR REPLACE non tocca i GRANT/REVOKE
-- esistenti) restano identici a 20260830000000.
--
-- Perché una nuova migration e non una modifica diretta a 20260830000000:
-- quella migration risulta già applicata al database di produzione (il bug
-- è stato riprodotto dal vivo). Editare il contenuto di un file di migration
-- già applicato non lo fa ri-eseguire da `supabase db push` (tracciato per
-- nome/timestamp nella tabella di stato delle migration) — lascerebbe il
-- repository "corretto" ma il database live ancora rotto, la stessa classe di
-- divergenza repo/DB già affrontata da questo progetto in passato (vedi
-- backend/scripts/check_rls_policies.js). Stessa strategia già usata da
-- questo repository per questo stesso bug (20260809000002 non ha mai
-- riscritto 20260808000005): una nuova migration, mai un edit retroattivo di
-- una migration già applicata.
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
    WHERE t.id = p_tenant_id AND (t.total_apps_created < t.app_limit OR t.beta_access = true)
    RETURNING t.total_apps_created, t.app_limit INTO v_total, v_limit;

    IF NOT FOUND THEN
        RETURN; -- limite raggiunto (e non beta), o tenant inesistente: nessuna riga, nessun incremento
    END IF;

    RETURN QUERY SELECT v_total, v_limit;
END;
$$;

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
