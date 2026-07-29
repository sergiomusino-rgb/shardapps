-- ============================================================================
-- ZeusX - RBAC (Role-Based Access Control) Schema Migration
-- Data: 2026-07-12
-- Descrizione: Aggiunge gestione ruoli per utenti client con accessi limitati
-- ============================================================================

-- 1. TABELLA APP_USERS - Utenti client con ruoli specifici
-- Collegata a auth.users per autenticazione Supabase
CREATE TABLE app_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('admin', 'agent', 'viewer', 'editor')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, app_id)
);

-- 2. INDICI
CREATE INDEX idx_app_users_app_id ON app_users(app_id);
CREATE INDEX idx_app_users_user_id ON app_users(user_id);
CREATE INDEX idx_app_users_role ON app_users(role);

-- 3. TRIGGER per updated_at
CREATE TRIGGER tr_app_users_updated_at BEFORE UPDATE ON app_users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4. RLS (Row Level Security)
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

-- Policy: gli utenti possono vedere i propri record
CREATE POLICY "app_users_select_own" ON app_users FOR SELECT USING (user_id = auth.uid());

-- Policy: gli owner dei tenant possono gestire gli app_users dei loro app
CREATE POLICY "app_users_manage_tenant_owner" ON app_users 
    FOR ALL 
    USING (
        app_id IN (
            SELECT a.id FROM apps a 
            JOIN tenant_members tm ON a.tenant_id = tm.tenant_id 
            WHERE tm.user_id = auth.uid() AND tm.role = 'owner'
        )
    )
    WITH CHECK (
        app_id IN (
            SELECT a.id FROM apps a 
            JOIN tenant_members tm ON a.tenant_id = tm.tenant_id 
            WHERE tm.user_id = auth.uid() AND tm.role = 'owner'
        )
    );

-- 5. ESTENSIONE tenant_members con permissions JSONB (opzionale, per permessi granulari)
-- Aggiungiamo un campo permissions per permessi su tabelle specifiche
ALTER TABLE tenant_members ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}';

-- 6. COMMENTI PER RUOLI
-- admin: Accesso completo a tutte le funzionalità
-- agent: Accesso limitato (es. solo ordini e prodotti in sola lettura)
-- viewer: Solo visualizzazione, nessuna modifica
-- editor: Modifica dati ma nessun accesso a impostazioni/admin

COMMENT ON TABLE app_users IS 'Utenti client con ruoli specifici per accessi limitati alle app figlie';
COMMENT ON COLUMN app_users.role IS 'Ruolo: admin (completo), agent (limitato), viewer (solo lettura), editor (modifica ma no admin)';