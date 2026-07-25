-- Script minimo: elimina TUTTO ciò che dipende da app_records e ricrea da zero
-- Copia questo nel SQL Editor di Supabase ed esegui

-- Step 1: Elimina trigger che potrebbero referenziare app_records.app_id
DROP TRIGGER IF EXISTS trigger_update_app_records_updated_at ON app_records;
DROP TRIGGER IF EXISTS tr_app_records_updated_at ON app_records;

-- Step 2: Elimina TUTTE le policy su app_records
DROP POLICY IF EXISTS "Users access only their tenant records" ON app_records;
DROP POLICY IF EXISTS "Tenant members access their app records" ON app_records;
DROP POLICY IF EXISTS "app_records_select_tenant_member" ON app_records;
DROP POLICY IF EXISTS "app_records_insert_tenant_member" ON app_records;
DROP POLICY IF EXISTS "app_records_update_tenant_member" ON app_records;
DROP POLICY IF EXISTS "app_records_delete_tenant_member" ON app_records;

-- Step 3: Disabilita temporaneamente RLS su app_records
ALTER TABLE IF EXISTS app_records DISABLE ROW LEVEL SECURITY;

-- Step 4: Elimina la tabella (se ancora esiste)
DROP TABLE IF EXISTS app_records CASCADE;

-- Step 5: Ricrea app_records con la struttura corretta
CREATE TABLE app_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 6: Indici
CREATE INDEX IF NOT EXISTS idx_app_records_app_id ON app_records(app_id);
CREATE INDEX IF NOT EXISTS idx_app_records_tenant_id ON app_records(tenant_id);
CREATE INDEX IF NOT EXISTS idx_app_records_table_name ON app_records(table_name);
CREATE INDEX IF NOT EXISTS idx_app_records_app_table ON app_records(app_id, table_name);
CREATE INDEX IF NOT EXISTS idx_app_records_data ON app_records USING GIN (data);

-- Step 7: Trigger updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_app_records_updated_at
  BEFORE UPDATE ON app_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Step 8: RLS + Policy
ALTER TABLE app_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_records_select_tenant_member" ON app_records
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())
  );

CREATE POLICY "app_records_insert_tenant_member" ON app_records
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())
  );

CREATE POLICY "app_records_update_tenant_member" ON app_records
  FOR UPDATE USING (
    tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())
  ) WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())
  );

CREATE POLICY "app_records_delete_tenant_member" ON app_records
  FOR DELETE USING (
    tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())
  );

-- Verifica
SELECT
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name = 'app_records'
ORDER BY ordinal_position;

SELECT count(*) AS policy_count
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'app_records';