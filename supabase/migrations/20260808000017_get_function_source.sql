-- ============================================================================
-- ZeusX - Funzione di introspezione: sorgente di una funzione per nome
-- (usata per auditare has_feature_access/has_table_access, mai definite in
-- nessuna migrazione di questo repo: create a mano su Dashboard, lo stesso
-- drift gia' visto su tenant_members/profiles)
-- Data: 2026-08-08
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_function_source(fn_name text)
RETURNS TABLE (
  schema_name text,
  full_signature text,
  source text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT
    n.nspname::text,
    (p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')::text,
    pg_get_functiondef(p.oid)::text
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname = fn_name
    AND n.nspname NOT IN ('pg_catalog', 'information_schema');
$$;

REVOKE ALL ON FUNCTION public.get_function_source(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_function_source(text) TO service_role;

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
