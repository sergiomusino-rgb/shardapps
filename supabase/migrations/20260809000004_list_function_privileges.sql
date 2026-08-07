-- ============================================================================
-- Introspezione: permessi EXECUTE reali sulle funzioni (schema public)
-- Data: 2026-08-09
-- Descrizione: nata dalla vulnerabilità critica chiusa in
-- 20260809000003_revoke_public_exec_sql.sql — exec_sql/execute_sql erano
-- eseguibili da PUBLIC perché mai state create da una migrazione (a mano su
-- Dashboard) e Postgres concede EXECUTE a PUBLIC di default alla creazione
-- di una funzione, salvo REVOKE esplicito. check_rls_policies.js controllava
-- solo le policy RLS sulle tabelle, categoria di controllo diversa: non
-- avrebbe mai intercettato questo. Stessa logica di list_rls_policies
-- (20260808000012): legge i permessi REALMENTE attivi sul database, non i
-- file di migrazione.
--
-- COALESCE(p.proacl, acldefault('f', p.proowner)) è il punto tecnico
-- centrale: se proacl è NULL (nessun GRANT/REVOKE esplicito è mai stato
-- eseguito su quella funzione), non significa "nessun permesso" — significa
-- "si applicano i permessi di default", che per le funzioni includono
-- EXECUTE a PUBLIC. acldefault('f', owner) restituisce esplicitamente quella
-- ACL di default, così una funzione mai toccata da GRANT/REVOKE risulta
-- comunque eseguibile da PUBLIC nel risultato — la falla non sarebbe stata
-- visibile altrimenti.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.list_function_privileges()
RETURNS TABLE (
  function_name text,
  full_signature text,
  is_security_definer boolean,
  is_extension_function boolean,
  is_trigger boolean,
  grantee text,
  privilege_type text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT
    p.proname::text,
    (p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')::text,
    p.prosecdef,
    -- pg_depend.deptype = 'e' marca gli oggetti "posseduti" da un'estensione
    -- installata (qui pg_trgm): quelle funzioni concedono EXECUTE a PUBLIC
    -- per comportamento standard di Postgres in ogni installazione che usa
    -- l'estensione, non per una svista di questo progetto — separate dalle
    -- funzioni custom dell'app invece di una lista di nomi da mantenere a mano.
    EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'),
    -- Le funzioni trigger (RETURNS trigger) non sono richiamabili
    -- direttamente via RPC/PostgREST — Postgres lo impedisce a livello di
    -- motore ("trigger functions can only be called as triggers") — quindi
    -- un EXECUTE a PUBLIC su di loro non è sfruttabile: escluse dal rumore.
    (p.prorettype = 'trigger'::regtype),
    (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END)::text,
    a.privilege_type::text
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND a.privilege_type = 'EXECUTE'
  ORDER BY p.proname, grantee;
$$;

REVOKE ALL ON FUNCTION public.list_function_privileges() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_function_privileges() TO service_role;

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
