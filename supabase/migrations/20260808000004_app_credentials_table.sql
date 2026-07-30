-- ============================================================================
-- ZeusX - Sposta le credenziali client in una tabella mai esposta alla API
-- Data: 2026-08-08
-- ============================================================================
-- Il REVOKE colonna-per-colonna su apps.client_password/initial_password
-- (20260723000002, e il tentativo odierno in 20260808000003) non regge:
-- Supabase riapplica automaticamente i permessi di colonna di default per
-- anon/authenticated su ogni tabella esposta alla Data API ad ogni deploy
-- dello schema, indipendentemente dai REVOKE manuali già eseguiti (verificato
-- live: stesso comportamento sia con `db query` che con una migration reale
-- via `db push` — il catalogo torna sempre a mostrare SELECT concesso).
-- `apps` deve restare parzialmente esposta ad anon (nome, email, config per
-- la pagina di login pubblica /a/[slug]), quindi non è possibile risolvere
-- il problema a livello di riga (RLS): serve spostare le sole colonne
-- credenziali su una tabella indipendente, mai esposta di default.
--
-- Questa migration è additiva e non tocca apps.client_password/
-- initial_password (restano popolate, invariate, per compatibilità con
-- eventuale codice non ancora aggiornato): il codice applicativo (backend
-- Express + route Next.js, tutte usano la service_role key che bypassa RLS e
-- i permessi di colonna comunque) viene aggiornato in parallelo a leggere e
-- scrivere qui. Una volta confermato il deploy, una migration di pulizia
-- azzererà le colonne legacy su apps.
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_credentials (
  app_id uuid PRIMARY KEY REFERENCES apps(id) ON DELETE CASCADE,
  client_password text,
  initial_password text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_credentials ENABLE ROW LEVEL SECURITY;

-- Stesso pattern già verificato funzionante per chats/messages/subscriptions:
-- nessun accesso per anon/authenticated, service_role bypassa RLS comunque.
CREATE POLICY "app_credentials_deny_anon_authenticated" ON app_credentials FOR ALL
  USING (false)
  WITH CHECK (false);

-- Backfill dai dati esistenti in apps.
INSERT INTO app_credentials (app_id, client_password, initial_password)
SELECT id, client_password, initial_password
FROM apps
WHERE client_password IS NOT NULL OR initial_password IS NOT NULL
ON CONFLICT (app_id) DO UPDATE
  SET client_password = EXCLUDED.client_password,
      initial_password = EXCLUDED.initial_password,
      updated_at = now();

-- La RPC esistente (20260723000002) leggeva da apps: ora legge dalla nuova
-- tabella, con fallback su apps per righe non ancora sincronizzate (nessuna
-- attesa, dato il backfill sopra, ma difensivo).
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
  SELECT COALESCE(ac.client_password, a.client_password),
         COALESCE(ac.initial_password, a.initial_password)
  FROM apps a
  LEFT JOIN app_credentials ac ON ac.app_id = a.id
  WHERE a.id = p_app_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_app_client_credentials(uuid) TO authenticated;

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
