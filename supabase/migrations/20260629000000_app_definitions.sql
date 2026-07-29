-- Migration: Tabella app_definitions per lo schema JSON delle app
-- Data: 2026-06-29
-- Descrizione: Memorizza le definizioni dello schema (tabelle, campi, relazioni)
-- per ogni app, separato dalla config generica. Permette versioning e caching.

CREATE TABLE IF NOT EXISTS app_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Schema JSON: contiene la definizione completa delle tabelle
    -- Esempio: { "tables": [{ "name": "clients", "label": "Cliente", "fields": [...] }] }
    schema JSONB NOT NULL DEFAULT '{"tables": []}'::jsonb,
    
    -- UI Config: personalizzazioni interfaccia (colori, layout, sidebar, dashboard)
    ui_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    
    -- Versione dello schema (incrementale per tracciare modifiche)
    version INTEGER NOT NULL DEFAULT 1,
    
    -- Flag per abilitare/disabilitare l'app client
    is_published BOOLEAN NOT NULL DEFAULT false,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Un solo definition per app
    UNIQUE(app_id)
);

-- Indici
CREATE INDEX IF NOT EXISTS idx_app_definitions_app_id ON app_definitions(app_id);
CREATE INDEX IF NOT EXISTS idx_app_definitions_tenant_id ON app_definitions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_app_definitions_published ON app_definitions(is_published) WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_app_definitions_schema ON app_definitions USING GIN (schema);

-- Trigger per updated_at
CREATE OR REPLACE FUNCTION update_app_definitions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_app_definitions_updated_at ON app_definitions;
CREATE TRIGGER trigger_update_app_definitions_updated_at
    BEFORE UPDATE ON app_definitions
    FOR EACH ROW
    EXECUTE FUNCTION update_app_definitions_updated_at();

-- RLS: solo membri del tenant possono accedere
ALTER TABLE app_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users access only their tenant definitions" ON app_definitions;
CREATE POLICY "Users access only their tenant definitions" ON app_definitions
    FOR ALL
    USING (
        tenant_id IN (
            SELECT tenant_id 
            FROM tenant_members 
            WHERE user_id = auth.uid()
        )
    );

-- Funzione helper: sincronizza schema da apps.config a app_definitions
-- Utile per migrare dati esistenti
CREATE OR REPLACE FUNCTION sync_app_definition_from_config()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO app_definitions (app_id, tenant_id, schema, ui_config, is_published)
    VALUES (
        NEW.id,
        NEW.tenant_id,
        COALESCE(NEW.config->'schema', NEW.config->'blueprint'->'schema', '{"tables": []}'::jsonb),
        COALESCE(NEW.config->'ui', NEW.config->'branding', '{}'::jsonb),
        COALESCE((NEW.config->>'is_published')::boolean, false)
    )
    ON CONFLICT (app_id) DO UPDATE SET
        schema = EXCLUDED.schema,
        ui_config = EXCLUDED.ui_config,
        updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Commenti documentazione
COMMENT ON TABLE app_definitions IS 'Definizioni schema JSON per le app generate dinamicamente';
COMMENT ON COLUMN app_definitions.schema IS 'Schema JSON con definizione tabelle, campi, tipi, relazioni';
COMMENT ON COLUMN app_definitions.ui_config IS 'Configurazione UI: colori, layout, sidebar, dashboard cards';
COMMENT ON COLUMN app_definitions.version IS 'Versione incrementale dello schema per tracciare modifiche';
COMMENT ON COLUMN app_definitions.is_published IS 'Se true, la definizione e pubblicata e visibile ai client';