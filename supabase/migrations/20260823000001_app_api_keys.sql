-- ============================================================================
-- ShardApps - Data Export + Public API: tabella API key per app
-- Data: 2026-08-23
-- ============================================================================
-- Ogni app (reseller) può emettere una o più API key per accedere ai propri
-- dati dall'esterno tramite la nuova Public API v1 (/api/v1/apps/:appId/...,
-- backend/routes/public-api.js). Stesso principio già in uso per
-- app_password_reset_tokens (20260809000008): si salva solo l'hash SHA-256
-- della chiave, mai il valore in chiaro — se il DB trapela, le chiavi già
-- emesse restano inutilizzabili. `key_prefix` è la sola porzione mostrabile
-- in UI dopo la creazione (es. "sa_live_4f9a2b1c"), per permettere
-- all'utente di riconoscere una chiave nell'elenco senza poterla mai
-- ricostruire.
--
-- Isolamento: app_id + tenant_id sono entrambi salvati (denormalizzazione
-- intenzionale, stesso pattern di app_records/app_action_logs) così il
-- middleware di autenticazione (public-api-auth.js) può impostare
-- req.appId/req.tenantId leggendo una sola riga, senza una query aggiuntiva
-- su apps — e una chiave resta vincolata a un'unica app anche se in futuro
-- apps.tenant_id cambiasse per qualche motivo.
--
-- Stesso pattern deny-all RLS di app_credentials/app_password_reset_tokens/
-- app_action_logs: nessun accesso diretto da anon/authenticated tramite la
-- Data API pubblica di Supabase, solo il backend Express (service_role,
-- bypassa RLS) può leggere/scrivere questa tabella.
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL,
  -- Scope minimi Fase 7: ['read'] oppure ['read','write']. jsonb (non un
  -- semplice text[]) per poter estendere in futuro senza migration
  -- aggiuntiva (es. scope per singola entità), stesso principio di
  -- apps.config.
  scopes jsonb NOT NULL DEFAULT '["read"]'::jsonb,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Lookup primario del middleware di auth: una query per hash, deve essere
-- indicizzato univocamente (collisione SHA-256 = chiave duplicata, non deve
-- mai capitare per due chiavi generate correttamente).
CREATE UNIQUE INDEX IF NOT EXISTS app_api_keys_key_hash_idx ON app_api_keys (key_hash);

-- Elenco chiavi di un'app (dashboard "Data & API").
CREATE INDEX IF NOT EXISTS app_api_keys_app_id_idx ON app_api_keys (app_id);

-- Indice parziale sulle sole chiavi attive (non revocate): la query più
-- frequente del middleware filtra sempre "non revocata", questo indice la
-- serve senza scansionare le chiavi già revocate/storiche.
CREATE INDEX IF NOT EXISTS app_api_keys_active_idx ON app_api_keys (app_id) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS app_api_keys_tenant_id_idx ON app_api_keys (tenant_id);

ALTER TABLE app_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_api_keys_deny_anon_authenticated" ON app_api_keys FOR ALL
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE app_api_keys IS 'API key per app (Public API v1 / data portability). Solo hash SHA-256 salvato, mai la chiave in chiaro. Vedi backend/lib/public-api-auth.js.';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
