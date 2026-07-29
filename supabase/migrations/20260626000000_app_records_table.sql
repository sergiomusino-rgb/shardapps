-- Migration: Tabella app_records per storage dati app
-- Data: 2026-06-26
-- Descrizione: Storage ibrido JSONB per record delle app generate

-- Rimuovi tabella vecchia se esiste (potrebbe avere struttura diversa)
DROP TABLE IF EXISTS app_records CASCADE;

-- Crea tabella app_records
CREATE TABLE app_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    table_name TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indici per performance
CREATE INDEX idx_app_records_app_id ON app_records(app_id);
CREATE INDEX idx_app_records_tenant_id ON app_records(tenant_id);
CREATE INDEX idx_app_records_table_name ON app_records(table_name);
CREATE INDEX idx_app_records_app_table ON app_records(app_id, table_name);
CREATE INDEX idx_app_records_data ON app_records USING GIN (data);

-- Trigger per aggiornare updated_at automaticamente
CREATE OR REPLACE FUNCTION update_app_records_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_app_records_updated_at
    BEFORE UPDATE ON app_records
    FOR EACH ROW
    EXECUTE FUNCTION update_app_records_updated_at();

-- Policy RLS: solo membri del tenant possono accedere ai record
ALTER TABLE app_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users access only their tenant records" ON app_records;
CREATE POLICY "Users access only their tenant records" ON app_records
    FOR ALL
    USING (
        tenant_id IN (
            SELECT tenant_id 
            FROM tenant_members 
            WHERE user_id = auth.uid()
        )
    );

-- Commento documentazione
COMMENT ON TABLE app_records IS 'Storage ibrido JSONB per record delle app generate - Fase 1 approccio ibrido';
COMMENT ON COLUMN app_records.data IS 'Contiene i dati del record in formato JSONB, struttura adattiva allo schema del blueprint';
