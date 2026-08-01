-- ============================================================================
-- ZeusX - Funzione di introspezione RLS per il controllo automatico
-- pre-deploy (backend/scripts/check_rls_policies.js)
-- Data: 2026-08-08
-- ============================================================================
--
-- pg_policies non è esposta via PostgREST (è in pg_catalog, non in uno schema
-- incluso nell'API): questa funzione la ripubblica come RPC, cosí lo script
-- di controllo può interrogarla con la sola service role key già in uso
-- ovunque nel progetto, senza bisogno di una connessione Postgres diretta o
-- di una nuova variabile d'ambiente.
--
-- SECURITY DEFINER perché pg_policies richiede privilegi che il ruolo
-- service_role da solo non ha sempre in ogni configurazione; l'accesso resta
-- comunque ristretto SOLO a service_role tramite GRANT/REVOKE espliciti
-- sotto — espone la struttura delle policy (non i dati delle tabelle), ma è
-- comunque informazione interna sulla sicurezza: non va mai concessa ad
-- anon/authenticated.
CREATE OR REPLACE FUNCTION public.list_rls_policies()
RETURNS TABLE (
  table_name text,
  policy_name text,
  is_permissive boolean,
  command text,
  roles text[],
  using_expr text,
  check_expr text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT
    tablename::text,
    policyname::text,
    (permissive = 'PERMISSIVE'),
    cmd::text,
    roles,
    qual::text,
    with_check::text
  FROM pg_policies
  WHERE schemaname = 'public';
$$;

REVOKE ALL ON FUNCTION public.list_rls_policies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_rls_policies() TO service_role;

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
