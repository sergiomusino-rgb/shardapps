-- ============================================================================
-- ZeusX - Blocco fughe di credenziali in chiaro e RLS subscriptions permissiva
-- Data: 2026-07-23
-- Descrizione: stress-test pre-lancio ha trovato due falle:
--
-- 1) La policy "apps_select_public_active" (20260703_client_access_policy.sql)
--    e "apps_select_by_totalum_app_id" (20260720_fix_apps_rls_for_totalum_app_id.sql)
--    filtrano solo per RIGA (client_active = true), non per colonna: chiunque
--    con la sola anon key poteva quindi leggere client_password/initial_password
--    in chiaro per QUALSIASI app attiva di QUALSIASI tenant via REST diretta
--    (es. GET /rest/v1/apps?select=slug,client_password&client_active=eq.true),
--    bypassando completamente la UI di login. Si revoca l'accesso a queste due
--    colonne per i ruoli anon/authenticated e si espone una RPC SECURITY
--    DEFINER che restituisce le credenziali solo a chi è effettivamente membro
--    del tenant proprietario dell'app (usata da dashboard/projects/[id] e
--    dashboard/management, aggiornate in parallelo per usarla).
--
-- 2) "subscriptions_manage_service_role" (20260630_rls_policies_auth_uid.sql)
--    ha USING(true) WITH CHECK(true) senza alcuna clausola TO: il commento
--    sopra la policy dichiara l'intento "condizione sempre-false per gli
--    utenti normali", quindi è un refuso (true al posto di false) che permette
--    a QUALSIASI ruolo (anon/authenticated inclusi, non solo service_role) di
--    inserire/modificare/cancellare subscription di qualunque tenant via REST
--    diretta.
-- ============================================================================

-- ─── 1) Colonne password di apps: mai leggibili da anon/authenticated ──────

REVOKE SELECT (client_password, initial_password) ON apps FROM anon, authenticated;

CREATE OR REPLACE FUNCTION get_app_client_credentials(p_app_id uuid)
RETURNS TABLE(client_password text, initial_password text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM apps a
    JOIN tenant_members tm ON tm.tenant_id = a.tenant_id
    WHERE a.id = p_app_id AND tm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Non autorizzato';
  END IF;

  RETURN QUERY
  SELECT a.client_password, a.initial_password FROM apps a WHERE a.id = p_app_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_app_client_credentials(uuid) TO authenticated;

-- ─── 2) Fix refuso RLS subscriptions (true -> false per utenti normali) ────

DROP POLICY IF EXISTS "subscriptions_manage_service_role" ON subscriptions;

CREATE POLICY "subscriptions_manage_service_role" ON subscriptions FOR ALL
  USING (false)
  WITH CHECK (false);

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
