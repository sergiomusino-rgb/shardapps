-- ============================================================================
-- ZeusX - CreatorAI Fase 3: utenti multi-ruolo per app rbac
-- Data: 2026-08-12
-- ============================================================================
-- app_credentials (20260808000004_app_credentials_table.sql) ha `app_id`
-- come PRIMARY KEY: 1 sola riga per app, corretto per il modello "password
-- unica condivisa" (auth_mode='legacy'), ma incompatibile con più utenti
-- sulla stessa app (auth_mode='rbac', ciascuno con la propria email+password
-- e un ruolo admin/operator/viewer).
--
-- Prima versione di questa migration provava a estendere app_credentials
-- stessa (colonna `role` + indici unici parziali per permettere più righe
-- solo per gli utenti rbac). Scartata: più punti del codice, backend e
-- frontend, fanno `.upsert(payload, { onConflict: 'app_id' })` su
-- app_credentials (backend/routes/client-app.js::setClientPassword,
-- backend/routes/app-records.js, frontend/app/api/creator/publish,
-- frontend/app/api/a/[slug]/update-credentials, .../reset-password/confirm,
-- frontend/app/api/generate/save) — PostgREST risolve `onConflict` solo
-- contro un vincolo unico non parziale sulle stesse colonne; un indice unico
-- PARZIALE su app_id (necessario per ammettere più righe rbac) avrebbe rotto
-- silenziosamente tutti questi upsert con "no unique or exclusion constraint
-- matching the ON CONFLICT specification". Vedi audit in fondo al file.
--
-- Scelta più sicura: tabella NUOVA e indipendente per gli utenti rbac,
-- app_credentials resta identica in tutto e per tutto (stessa PK, stessi
-- vincoli, stessi upsert) — zero rischio per il modello legacy esistente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_rbac_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_email text NOT NULL,
  -- Stesso modello di sicurezza del legacy (client_password in chiaro su
  -- apps/app_credentials): nessun hashing/JWT qui, dichiarato esplicitamente
  -- invece di far finta di avere qualcosa di più robusto — vedi
  -- backend/lib/client-auth.js::getRbacCredential.
  client_password text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'operator', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Un'email non può avere due account sulla stessa app. lower() per un
-- confronto case-insensitive in login (backend/lib/client-auth.js).
CREATE UNIQUE INDEX IF NOT EXISTS app_rbac_users_app_email_unique
  ON app_rbac_users(app_id, lower(client_email));

CREATE INDEX IF NOT EXISTS idx_app_rbac_users_app_id ON app_rbac_users(app_id);
CREATE INDEX IF NOT EXISTS idx_app_rbac_users_tenant_id ON app_rbac_users(tenant_id);

ALTER TABLE app_rbac_users ENABLE ROW LEVEL SECURITY;

-- Stesso pattern deny-all di app_credentials (20260808000004): nessun
-- accesso per anon/authenticated dalla Data API pubblica, solo backend
-- Express + route Next.js con la service_role key (bypassa RLS).
CREATE POLICY "app_rbac_users_deny_anon_authenticated" ON app_rbac_users FOR ALL
  USING (false)
  WITH CHECK (false);

CREATE TRIGGER tr_app_rbac_users_updated_at
  BEFORE UPDATE ON app_rbac_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE app_rbac_users IS 'Utenti individuali (email+password+ruolo) di un''app auth_mode=''rbac'' (Fase 3 CreatorAI, site-schema.ts::authConfig) — indipendente da app_credentials, che resta la credenziale unica condivisa delle app auth_mode=''legacy''.';

-- apps.auth_mode: aggiunge 'rbac' ai valori ammessi (era solo
-- 'legacy'/'supabase', vedi 20260725000000_add_auth_mode_to_apps.sql).
ALTER TABLE apps DROP CONSTRAINT IF EXISTS apps_auth_mode_check;
ALTER TABLE apps ADD CONSTRAINT apps_auth_mode_check
  CHECK (auth_mode IN ('legacy', 'supabase', 'rbac'));

COMMENT ON COLUMN apps.auth_mode IS 'legacy = accesso cliente a password condivisa (app esistenti); supabase = login/registrazione reali via Supabase Auth + app_users; rbac = più utenti/ruoli (admin/operator/viewer) via app_rbac_users, vedi site-schema.ts::authConfig';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
