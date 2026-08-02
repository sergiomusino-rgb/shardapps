-- ============================================================================
-- ZeusX - Funzione di introspezione: stato RLS di OGNI tabella dello schema
-- public (non solo quelle con almeno una policy)
-- Data: 2026-08-08
-- ============================================================================
--
-- list_rls_policies() (20260808000012) elenca le policy esistenti, ma una
-- tabella con RLS MAI abilitato (ALTER TABLE ... ENABLE ROW LEVEL SECURITY
-- mai eseguito) non ha nessuna policy da elencare — eppure è completamente
-- aperta a chiunque abbia un grant sulla tabella (tipicamente ogni utente
-- autenticato, per i default di Supabase). Questa funzione permette di
-- distinguere "nessuna policy perché tutto vietato" (RLS attivo, 0 policy)
-- da "nessuna policy perché RLS non è mai stato attivato" (tutto aperto).
CREATE OR REPLACE FUNCTION public.list_table_rls_status()
RETURNS TABLE (
  table_name text,
  rls_enabled boolean,
  rls_forced boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT
    c.relname::text,
    c.relrowsecurity,
    c.relforcerowsecurity
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'; -- solo tabelle vere, non viste/sequenze
$$;

REVOKE ALL ON FUNCTION public.list_table_rls_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_table_rls_status() TO service_role;

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
