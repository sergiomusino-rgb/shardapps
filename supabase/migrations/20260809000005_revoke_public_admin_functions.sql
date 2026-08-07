-- ============================================================================
-- CRITICO: revoca esecuzione pubblica di 4 funzioni admin/finanziarie
-- Data: 2026-08-09
-- Descrizione: trovate estendendo check_rls_policies.js ai permessi sulle
-- funzioni (dopo la vulnerabilità exec_sql/execute_sql, vedi
-- 20260809000003). A differenza di quel caso, queste ERANO create da una
-- migrazione regolare (20260714000000_create_app_registry_table.sql,
-- 20260715000002_reseller_debts_function.sql,
-- 20260716000000_admin_takeover_function.sql) — il problema non è drift da
-- Dashboard, è che quelle migrazioni non hanno mai fatto un REVOKE FROM
-- PUBLIC esplicito, e Postgres concede EXECUTE a PUBLIC di default alla
-- creazione di una funzione.
--
-- Le 4 funzioni sono SECURITY DEFINER SENZA alcun controllo interno
-- sull'identità del chiamante (nessun auth.uid(), nessun controllo ruolo nel
-- corpo) — l'unica protezione prevista era il controllo verifyAdmin() nelle
-- route Next.js che le chiamano (app/api/admin/{takeover,mark-paid,
-- reseller-debts}/route.ts), tutte già scritte per usare service_role.
-- Chiamando le funzioni direttamente via RPC (bypassando quelle route),
-- verificato con una sessione utente autenticata reale, chiunque poteva:
--
--   - admin_takeover_reseller_app: riassegnare la proprietà di QUALSIASI
--     app registrata a un account admin fisso, senza consenso del reseller
--   - mark_reseller_transactions_paid: azzerare le transazioni pending (=
--     debito/commissione dovuta alla piattaforma) di QUALSIASI reseller
--   - get_reseller_debts: leggere email, nome e debito totale di TUTTI i
--     reseller — nessun parametro, nessun filtro per il chiamante
--   - get_zeusx_total_due: leggere quanto la piattaforma deve a un
--     qualsiasi reseller dato il suo UUID
--
-- Fix: stesso schema di 20260809000003 — REVOKE da PUBLIC/authenticated/
-- anon, GRANT solo a service_role (le 3 route admin lo usano già, nessuna
-- funzionalità legittima si rompe — verificato). to_regprocedure(...) IS
-- NOT NULL per lo stesso motivo di sicurezza-di-replay già corretto lì:
-- queste 4 funzioni SONO create da una migrazione precedente, quindi in
-- teoria esistono già quando questo file gira in sequenza — la guardia resta
-- comunque per coerenza e per tollerare un DB parziale/in ricostruzione.
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.admin_takeover_reseller_app(uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.admin_takeover_reseller_app(uuid) FROM PUBLIC, authenticated, anon;
    GRANT EXECUTE ON FUNCTION public.admin_takeover_reseller_app(uuid) TO service_role;
  END IF;

  IF to_regprocedure('public.mark_reseller_transactions_paid(uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.mark_reseller_transactions_paid(uuid) FROM PUBLIC, authenticated, anon;
    GRANT EXECUTE ON FUNCTION public.mark_reseller_transactions_paid(uuid) TO service_role;
  END IF;

  IF to_regprocedure('public.get_reseller_debts()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.get_reseller_debts() FROM PUBLIC, authenticated, anon;
    GRANT EXECUTE ON FUNCTION public.get_reseller_debts() TO service_role;
  END IF;

  IF to_regprocedure('public.get_zeusx_total_due(uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.get_zeusx_total_due(uuid) FROM PUBLIC, authenticated, anon;
    GRANT EXECUTE ON FUNCTION public.get_zeusx_total_due(uuid) TO service_role;
  END IF;
END $$;

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
