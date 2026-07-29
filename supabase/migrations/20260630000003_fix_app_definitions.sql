-- Script per correggere la creazione di app_definitions
-- Copia questo nel SQL Editor di Supabase ed esegui DOPO aver eseguito gli altri script principali

-- Step 1: Elimina trigger su app_definitions (se esistono)
DROP TRIGGER IF EXISTS tr_app_definitions_updated_at ON app_definitions;

-- Le policy RLS sono già definite in 20260630_rls_policies_auth_uid.sql
-- Non è necessario ricrearle qui per evitare conflitti.

-- Step 2: Disabilita RLS temporaneamente
ALTER TABLE IF EXISTS app_definitions DISABLE ROW LEVEL SECURITY;

-- Step 3: Elimina la tabella app_definitions (se esiste)
DROP TABLE IF EXISTS app_definitions CASCADE;

-- Step 4: Ricrea app_definitions con la colonna app_id corretta
CREATE TABLE app_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE, -- Assicurati che questa colonna esista in 'apps'
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  schema JSONB NOT NULL DEFAULT '{"tables": []}'::jsonb,
  ui_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(app_id)
);

-- Step 5: Indici
CREATE INDEX IF NOT EXISTS idx_app_definitions_app_id ON app_definitions(app_id);
CREATE INDEX IF NOT EXISTS idx_app_definitions_tenant_id ON app_definitions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_app_definitions_published ON app_definitions(is_published) WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_app_definitions_schema ON app_definitions USING GIN (schema);

-- Step 6: Trigger updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_app_definitions_updated_at
  BEFORE UPDATE ON app_definitions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Step 7: Abilita RLS (le policy verranno create dallo script rls_policies_auth_uid.sql)
ALTER TABLE app_definitions ENABLE ROW LEVEL SECURITY;

-- Verifica finale (questa verifica è solo per la struttura della tabella, non per le policy)
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'app_definitions' ORDER BY ordinal_position;
