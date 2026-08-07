-- ============================================================================
-- CRITICO: revoca esecuzione pubblica su funzioni crediti + tooling + varie
-- Data: 2026-08-09
-- Descrizione: terzo giro dello stesso audit (dopo 20260809000003 exec_sql/
-- execute_sql e 20260809000005 funzioni admin/reseller). Estendendo
-- check_rls_policies.js ai permessi sulle funzioni sono emersi altri due
-- problemi distinti:
--
-- 1) Anche funzioni "già chiuse" con REVOKE ALL FROM PUBLIC nella loro
--    migrazione originale (get_function_source, list_rls_policies,
--    list_table_rls_status, list_function_privileges) restavano eseguibili
--    da anon/authenticated: Supabase concede EXECUTE su ogni nuova funzione
--    ad anon/authenticated per default di progetto (ALTER DEFAULT
--    PRIVILEGES), e "REVOKE ALL FROM PUBLIC" non tocca un grant esplicito
--    già dato a un ruolo specifico. Verificato: un utente autenticato
--    normale poteva leggere il sorgente di QUALSIASI funzione via
--    get_function_source.
--
-- 2) deduct_credits/grant_credits/refund_credits (crediti Vision, usati per
--    la generazione video AI) sono SECURITY DEFINER SENZA alcun controllo
--    sul chiamante — l'user_id arriva come parametro, non da auth.uid().
--    Verificato con un utente ANONIMO (nessun login): poteva chiamare
--    grant_credits con qualunque user_id e amount, ottenendo crediti
--    illimitati gratis — abuso diretto di costo reale (chiamate API AI).
--    deduct_credits nella stessa direzione permette di azzerare i crediti
--    di qualunque altro utente. Tutti e 3 i chiamanti reali nel codebase
--    (backend/server.js, routes/stripe.js, webhooks/stripe/route.ts,
--    generate-video/route.ts, concat-videos/route.ts) usano già
--    service_role: nessuna funzionalità legittima si rompe.
--
-- 3) increment_tenant_app_count (fix SQL in 20260809000002) aveva anche lo
--    stesso problema di grant: PUBLIC + anon + authenticated, verificato
--    chiamabile anche senza login per incrementare il contatore app di
--    QUALSIASI tenant (rischio di sabotaggio/esaurimento slot altrui).
--    L'unico chiamante reale (api/creator/create, api/apps) usa già
--    service_role.
--
-- 4) 9 funzioni SECURITY DEFINER o comunque prive di controllo interno
--    sul chiamante, senza nessun chiamante reale trovato nel codebase (o con
--    un unico chiamante già su service_role): add_tenant_slots,
--    check_rate_limit, count_tenant_apps, get_app_for_takeover,
--    get_reseller_apps, get_reseller_apps_with_total, get_user_tenant_ids,
--    is_app_accessible, is_tenant_member. add_tenant_slots non è nemmeno
--    SECURITY DEFINER, quindi restava già protetta dalla RLS reale di
--    tenants (verificato: una UPDATE da anon non modificava nulla) — ma un
--    grant così ampio su una funzione che tocca lo slot a pagamento di un
--    tenant è comunque sbagliato per igiene, indipendentemente dal fatto che
--    oggi non sia sfruttabile.
--
-- NON toccate qui (grant ampio intenzionale, verificato corretto): ognuna
-- filtra esplicitamente su auth.uid() prima di restituire dati, quindi
-- resta sicura anche con un grant ampio — get_app_client_credentials,
-- get_my_tenant_ids, has_feature_access, has_table_access,
-- is_member_of_tenant, get_tenant_slots_available (quest'ultima non è
-- SECURITY DEFINER, protetta dalla RLS di tenants come add_tenant_slots).
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.get_function_source(text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.get_function_source(text) FROM PUBLIC, authenticated, anon;
    GRANT EXECUTE ON FUNCTION public.get_function_source(text) TO service_role;
  END IF;

  IF to_regprocedure('public.list_rls_policies()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.list_rls_policies() FROM PUBLIC, authenticated, anon;
    GRANT EXECUTE ON FUNCTION public.list_rls_policies() TO service_role;
  END IF;

  IF to_regprocedure('public.list_table_rls_status()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.list_table_rls_status() FROM PUBLIC, authenticated, anon;
    GRANT EXECUTE ON FUNCTION public.list_table_rls_status() TO service_role;
  END IF;

  IF to_regprocedure('public.list_function_privileges()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.list_function_privileges() FROM PUBLIC, authenticated, anon;
    GRANT EXECUTE ON FUNCTION public.list_function_privileges() TO service_role;
  END IF;

  IF to_regprocedure('public.increment_tenant_app_count(uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.increment_tenant_app_count(uuid) FROM PUBLIC, authenticated, anon;
    GRANT EXECUTE ON FUNCTION public.increment_tenant_app_count(uuid) TO service_role;
  END IF;

  IF to_regprocedure('public.deduct_credits(uuid, integer, text, text, text, jsonb)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.deduct_credits(uuid, integer, text, text, text, jsonb) FROM PUBLIC, authenticated, anon;
    GRANT EXECUTE ON FUNCTION public.deduct_credits(uuid, integer, text, text, text, jsonb) TO service_role;
  END IF;

  IF to_regprocedure('public.grant_credits(uuid, integer, text, text, text, jsonb)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.grant_credits(uuid, integer, text, text, text, jsonb) FROM PUBLIC, authenticated, anon;
    GRANT EXECUTE ON FUNCTION public.grant_credits(uuid, integer, text, text, text, jsonb) TO service_role;
  END IF;

  IF to_regprocedure('public.refund_credits(uuid, integer, text, text, jsonb)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.refund_credits(uuid, integer, text, text, jsonb) FROM PUBLIC, authenticated, anon;
    GRANT EXECUTE ON FUNCTION public.refund_credits(uuid, integer, text, text, jsonb) TO service_role;
  END IF;

  IF to_regprocedure('public.add_tenant_slots(uuid, integer)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.add_tenant_slots(uuid, integer) FROM PUBLIC, authenticated, anon;
    GRANT EXECUTE ON FUNCTION public.add_tenant_slots(uuid, integer) TO service_role;
  END IF;

  IF to_regprocedure('public.check_rate_limit(text, integer, integer)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) FROM PUBLIC, authenticated, anon;
    GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) TO service_role;
  END IF;

  IF to_regprocedure('public.count_tenant_apps(uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.count_tenant_apps(uuid) FROM PUBLIC, authenticated, anon;
    GRANT EXECUTE ON FUNCTION public.count_tenant_apps(uuid) TO service_role;
  END IF;

  IF to_regprocedure('public.get_app_for_takeover(uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.get_app_for_takeover(uuid) FROM PUBLIC, authenticated, anon;
    GRANT EXECUTE ON FUNCTION public.get_app_for_takeover(uuid) TO service_role;
  END IF;

  IF to_regprocedure('public.get_reseller_apps(uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.get_reseller_apps(uuid) FROM PUBLIC, authenticated, anon;
    GRANT EXECUTE ON FUNCTION public.get_reseller_apps(uuid) TO service_role;
  END IF;

  IF to_regprocedure('public.get_reseller_apps_with_total(uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.get_reseller_apps_with_total(uuid) FROM PUBLIC, authenticated, anon;
    GRANT EXECUTE ON FUNCTION public.get_reseller_apps_with_total(uuid) TO service_role;
  END IF;

  IF to_regprocedure('public.get_user_tenant_ids(uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.get_user_tenant_ids(uuid) FROM PUBLIC, authenticated, anon;
    GRANT EXECUTE ON FUNCTION public.get_user_tenant_ids(uuid) TO service_role;
  END IF;

  IF to_regprocedure('public.is_app_accessible(uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.is_app_accessible(uuid) FROM PUBLIC, authenticated, anon;
    GRANT EXECUTE ON FUNCTION public.is_app_accessible(uuid) TO service_role;
  END IF;

  IF to_regprocedure('public.is_tenant_member(uuid, uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.is_tenant_member(uuid, uuid) FROM PUBLIC, authenticated, anon;
    GRANT EXECUTE ON FUNCTION public.is_tenant_member(uuid, uuid) TO service_role;
  END IF;
END $$;

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
