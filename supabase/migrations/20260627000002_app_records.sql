-- Tabella per i records delle app
CREATE TABLE IF NOT EXISTS app_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indici per performance
CREATE INDEX IF NOT EXISTS idx_app_records_app_id ON app_records(app_id);
CREATE INDEX IF NOT EXISTS idx_app_records_tenant_id ON app_records(tenant_id);
CREATE INDEX IF NOT EXISTS idx_app_records_table_name ON app_records(table_name);
CREATE INDEX IF NOT EXISTS idx_app_records_app_table ON app_records(app_id, table_name);

-- RLS (Row Level Security) - disabilitato per ora, il backend usa service role
ALTER TABLE app_records ENABLE ROW LEVEL SECURITY;
