-- ============================================================================
-- ZeusX - Script SQL MASTER per la configurazione completa del database
-- Data: 2026-06-30
-- Compatibilità: Supabase (PostgreSQL 15+)
-- Descrizione: Elimina e ricrea tutte le tabelle, funzioni, trigger e policy RLS
-- ============================================================================

-- 0. PULIZIA
ALTER TABLE IF EXISTS profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS tenants DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS tenant_members DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS blueprints DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS apps DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS app_definitions DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS app_records DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS subscriptions DISABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS tr_subscriptions_updated_at ON subscriptions;
DROP TRIGGER IF EXISTS tr_app_records_updated_at ON app_records;
DROP TRIGGER IF EXISTS tr_apps_sync_definition ON apps;
DROP TRIGGER IF EXISTS tr_app_definitions_updated_at ON app_definitions;
DROP TRIGGER IF EXISTS tr_apps_updated_at ON apps;
DROP TRIGGER IF EXISTS tr_blueprints_updated_at ON blueprints;
DROP TRIGGER IF EXISTS tr_tenants_updated_at ON tenants;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS tr_profiles_updated_at ON profiles;

DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
DROP POLICY IF EXISTS "profiles_delete_own" ON profiles;
DROP POLICY IF EXISTS "tenants_select_member" ON tenants;
DROP POLICY IF EXISTS "tenants_insert_authenticated" ON tenants;
DROP POLICY IF EXISTS "tenants_update_owner" ON tenants;
DROP POLICY IF EXISTS "tenants_delete_owner" ON tenants;
DROP POLICY IF EXISTS "tenant_members_select_own" ON tenant_members;
DROP POLICY IF EXISTS "tenant_members_manage_owner" ON tenant_members;
DROP POLICY IF EXISTS "blueprints_select_public" ON blueprints;
DROP POLICY IF EXISTS "blueprints_manage_service_role" ON blueprints;
DROP POLICY IF EXISTS "apps_select_tenant_member" ON apps;
DROP POLICY IF EXISTS "apps_insert_tenant_member" ON apps;
DROP POLICY IF EXISTS "apps_update_tenant_member" ON apps;
DROP POLICY IF EXISTS "apps_delete_tenant_member" ON apps;
DROP POLICY IF EXISTS "app_definitions_select_tenant_member" ON app_definitions;
DROP POLICY IF EXISTS "app_definitions_insert_tenant_member" ON app_definitions;
DROP POLICY IF EXISTS "app_definitions_update_tenant_member" ON app_definitions;
DROP POLICY IF EXISTS "app_definitions_delete_tenant_member" ON app_definitions;
DROP POLICY IF EXISTS "app_records_select_tenant_member" ON app_records;
DROP POLICY IF EXISTS "app_records_insert_tenant_member" ON app_records;
DROP POLICY IF EXISTS "app_records_update_tenant_member" ON app_records;
DROP POLICY IF EXISTS "app_records_delete_tenant_member" ON app_records;
DROP POLICY IF EXISTS "subscriptions_select_tenant_member" ON subscriptions;
DROP POLICY IF EXISTS "subscriptions_manage_service_role" ON subscriptions;

DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS app_records CASCADE;
DROP TABLE IF EXISTS app_definitions CASCADE;
DROP TABLE IF EXISTS apps CASCADE;
DROP TABLE IF EXISTS blueprints CASCADE;
DROP TABLE IF EXISTS tenant_members CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

DROP FUNCTION IF EXISTS public.sync_app_definition_from_config();
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP FUNCTION IF EXISTS public.update_updated_at_column();

-- 1. FUNZIONI
CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER AS $$
DECLARE new_tenant_id UUID; user_email TEXT;
BEGIN
  INSERT INTO public.profiles (user_id, email) VALUES (NEW.id, NEW.email) ON CONFLICT (user_id) DO NOTHING;
  user_email := NEW.email;
  INSERT INTO public.tenants (owner_id, name, slug) VALUES (NEW.id, user_email || '''s Workspace', REPLACE(user_email, '@', '-') || '-workspace') RETURNING id INTO new_tenant_id;
  INSERT INTO public.tenant_members (tenant_id, user_id, role) VALUES (new_tenant_id, NEW.id, 'owner');
  RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION sync_app_definition_from_config() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO app_definitions (app_id, tenant_id, schema, ui_config, is_published)
  VALUES (NEW.id, NEW.tenant_id, COALESCE(NEW.config->'schema', NEW.config->'blueprint'->'schema', '{"tables": []}'::jsonb), COALESCE(NEW.config->'ui', NEW.config->'branding', '{}'::jsonb), COALESCE((NEW.config->>'is_published')::boolean, false))
  ON CONFLICT (app_id) DO UPDATE SET schema = EXCLUDED.schema, ui_config = EXCLUDED.ui_config, updated_at = NOW();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- 2. TABELLE
CREATE TABLE profiles (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE, email TEXT, full_name TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE tenants (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), owner_id UUID NOT NULL REFERENCES auth.users(id), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, plan TEXT NOT NULL DEFAULT 'free', app_limit INT NOT NULL DEFAULT 1, total_apps_created INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE tenant_members (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, role TEXT NOT NULL DEFAULT 'member', created_at TIMESTAMPTZ DEFAULT now(), UNIQUE(tenant_id, user_id));
CREATE TABLE blueprints (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), sector TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, description TEXT, schema JSONB NOT NULL DEFAULT '{}'::jsonb, ui_config JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE apps (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, blueprint_id UUID REFERENCES blueprints(id) ON DELETE SET NULL, name TEXT NOT NULL, slug TEXT UNIQUE, config JSONB NOT NULL DEFAULT '{}'::jsonb, client_password TEXT, client_email TEXT, client_active BOOLEAN NOT NULL DEFAULT true, expires_at TIMESTAMPTZ, expiry_warning_sent BOOLEAN NOT NULL DEFAULT false, trial_ends_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'), is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE app_definitions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE, tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, schema JSONB NOT NULL DEFAULT '{"tables": []}'::jsonb, ui_config JSONB NOT NULL DEFAULT '{}'::jsonb, version INTEGER NOT NULL DEFAULT 1, is_published BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(app_id));
CREATE TABLE app_records (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE, tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, table_name TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE subscriptions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE, stripe_customer_id TEXT, stripe_subscription_id TEXT, status TEXT NOT NULL DEFAULT 'incomplete', current_period_start TIMESTAMPTZ, current_period_end TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());

-- 4. TRIGGER
CREATE TRIGGER tr_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
CREATE TRIGGER tr_tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER tr_blueprints_updated_at BEFORE UPDATE ON blueprints FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER tr_apps_updated_at BEFORE UPDATE ON apps FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER tr_app_definitions_updated_at BEFORE UPDATE ON app_definitions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER tr_apps_sync_definition AFTER INSERT ON apps FOR EACH ROW EXECUTE FUNCTION sync_app_definition_from_config();
CREATE TRIGGER tr_app_records_updated_at BEFORE UPDATE ON app_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER tr_subscriptions_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5. RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY; ALTER TABLE tenants ENABLE ROW LEVEL SECURITY; ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY; ALTER TABLE blueprints ENABLE ROW LEVEL SECURITY; ALTER TABLE apps ENABLE ROW LEVEL SECURITY; ALTER TABLE app_definitions ENABLE ROW LEVEL SECURITY; ALTER TABLE app_records ENABLE ROW LEVEL SECURITY; ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own" ON profiles FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "profiles_delete_own" ON profiles FOR DELETE USING (user_id = auth.uid());
CREATE POLICY "tenants_select_member" ON tenants FOR SELECT USING (id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "tenants_insert_authenticated" ON tenants FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND owner_id = auth.uid());
CREATE POLICY "tenants_update_owner" ON tenants FOR UPDATE USING (id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role = 'owner')) WITH CHECK (id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role = 'owner'));
CREATE POLICY "tenants_delete_owner" ON tenants FOR DELETE USING (id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role = 'owner'));
CREATE POLICY "tenant_members_select_own" ON tenant_members FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "tenant_members_manage_owner" ON tenant_members FOR ALL USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role = 'owner')) WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role = 'owner'));
CREATE POLICY "blueprints_select_public" ON blueprints FOR SELECT USING (true);
CREATE POLICY "blueprints_manage_service_role" ON blueprints FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "apps_select_tenant_member" ON apps FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "apps_insert_tenant_member" ON apps FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "apps_update_tenant_member" ON apps FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())) WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "apps_delete_tenant_member" ON apps FOR DELETE USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "app_definitions_select_tenant_member" ON app_definitions FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "app_definitions_insert_tenant_member" ON app_definitions FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "app_definitions_update_tenant_member" ON app_definitions FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())) WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "app_definitions_delete_tenant_member" ON app_definitions FOR DELETE USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "app_records_select_tenant_member" ON app_records FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "app_records_insert_tenant_member" ON app_records FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "app_records_update_tenant_member" ON app_records FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())) WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "app_records_delete_tenant_member" ON app_records FOR DELETE USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "subscriptions_select_tenant_member" ON subscriptions FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "subscriptions_manage_service_role" ON subscriptions FOR ALL USING (true) WITH CHECK (true);

-- 6. SEED DATA
INSERT INTO blueprints (sector, display_name, description, schema, ui_config) VALUES 
('oculista', 'Studio Oculistico', 'Gestionale per studi oculistici.', '{"tables": [{"name": "patients", "label": "Paziente", "fields": [{"id": "last_name", "type": "text", "label": "Cognome", "required": true}]}]}', '{"primaryColor": "#6366f1"}'),
('officina', 'Officina Meccanica', 'Gestionale per officine.', '{"tables": [{"name": "vehicles", "label": "Veicolo", "fields": [{"id": "plate", "type": "text", "label": "Targa", "required": true}]}]}', '{"primaryColor": "#f59e0b"}'),
('ristorante', 'Ristorante', 'Gestionale per ristoranti.', '{"tables": [{"name": "dishes", "label": "Piatto", "fields": [{"id": "name", "type": "text", "label": "Nome", "required": true}]}]}', '{"primaryColor": "#ef4444"}')
ON CONFLICT (sector) DO UPDATE SET display_name = EXCLUDED.display_name, description = EXCLUDED.description, schema = EXCLUDED.schema, ui_config = EXCLUDED.ui_config, updated_at = NOW();

-- FINE SCRIPT
