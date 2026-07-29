-- STEP 1: Pulizia aggressiva di TUTTI gli oggetti relativi ad app_records
--         (trigger, policy, poi DROP TABLE e ricreazione)
-- Incolla questo script nel SQL Editor di Supabase ed esegui PRIMA di ogni altro.

-- Elimina tutti i trigger associati ad app_records (se esistono)
DROP TRIGGER IF EXISTS trigger_update_app_records_updated_at ON app_records;
DROP TRIGGER IF EXISTS tr_app_records_updated_at ON app_records;
-- Aggiungi qui altri nomi di trigger se la diagnosi ne rivela altri

-- Elimina tutte le policy esistenti su app_records
DROP POLICY IF EXISTS "Users access only their tenant records" ON app_records;
DROP POLICY IF EXISTS "Tenant members access their app records" ON app_records;
DROP POLICY IF EXISTS "app_records_select_tenant_member" ON app_records;
DROP POLICY IF EXISTS "app_records_insert_tenant_member" ON app_records;
DROP POLICY IF EXISTS "app_records_update_tenant_member" ON app_records;
DROP POLICY IF EXISTS "app_records_delete_tenant_member" ON app_records;

-- Disabilita RLS temporaneamente
ALTER TABLE IF EXISTS app_records DISABLE ROW LEVEL SECURITY;

-- Elimina la tabella app_records (se esiste)
DROP TABLE IF EXISTS app_records CASCADE;

-- STEP 2: Esegui lo script di creazione completo (schema + RLS + seed)
--         Questo script ricrea la tabella app_records con la struttura corretta
--         e applica tutte le policy RLS.
--         (Contenuto di 20260630_fix_app_records_final.sql)

-- ============================================================================
-- ZeusX - Fix app_records (DROP & RECREATE) + RLS completo
-- Data: 2026-06-30
-- DA COPIARE E INCOLLARE NEL SQL EDITOR DI SUPABASE
-- ============================================================================

-- ️ FASE 0: Elimina e ricrea app_records (i dati esistenti andranno persi)
--    Questo è necessario perché la tabella ha una struttura vecchia
--    incompatibile (manca la colonna app_id).
-- ============================================================================

-- DROP TABLE IF EXISTS app_records CASCADE; -- Già eseguito sopra

CREATE TABLE app_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- FASE 1: Aggiungi colonne mancanti alle altre tabelle
-- ============================================================================

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS app_limit INT NOT NULL DEFAULT 1;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS total_apps_created INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.constraint_column_usage WHERE table_name = 'tenants' AND constraint_name = 'tenants_plan_check') THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_plan_check CHECK (plan IN ('free', 'starter', 'pro', 'business'));
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE tenant_members ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';
ALTER TABLE tenant_members ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.constraint_column_usage WHERE table_name = 'tenant_members' AND constraint_name = 'tenant_members_role_check') THEN
    ALTER TABLE tenant_members ADD CONSTRAINT tenant_members_role_check CHECK (role IN ('owner', 'admin', 'member'));
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'tenant_members' AND constraint_type = 'UNIQUE') THEN
    ALTER TABLE tenant_members ADD CONSTRAINT tenant_members_tenant_user_unique UNIQUE (tenant_id, user_id);
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE apps ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS client_password TEXT;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS client_email TEXT;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS client_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS expiry_warning_sent BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days');
ALTER TABLE apps ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE TABLE IF NOT EXISTS app_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  schema JSONB NOT NULL DEFAULT '{"tables": []}'::jsonb,
  ui_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(app_id)
);

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'incomplete';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.constraint_column_usage WHERE table_name = 'subscriptions' AND constraint_name = 'subscriptions_status_check') THEN
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check CHECK (status IN ('incomplete', 'active', 'past_due', 'canceled', 'trialing'));
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ============================================================================
-- FASE 2: Funzioni
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION sync_app_definition_from_config()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO app_definitions (app_id, tenant_id, schema, ui_config, is_published)
  VALUES (
    NEW.id, NEW.tenant_id,
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

-- ============================================================================
-- FASE 3: Trigger
-- ============================================================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['tenants', 'apps', 'subscriptions', 'profiles', 'blueprints', 'app_definitions', 'app_records']
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = tbl AND table_schema = 'public') THEN
      EXECUTE format('DROP TRIGGER IF EXISTS tr_%s_updated_at ON %I', tbl, tbl);
      EXECUTE format('CREATE TRIGGER tr_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', tbl, tbl);
    END IF;
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS tr_apps_sync_definition ON apps;
CREATE TRIGGER tr_apps_sync_definition AFTER INSERT ON apps
  FOR EACH ROW EXECUTE FUNCTION sync_app_definition_from_config();

-- ============================================================================
-- FASE 4: Indici
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_owner_id ON tenants(owner_id);
CREATE INDEX IF NOT EXISTS idx_tenant_members_tenant_id ON tenant_members(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_members_user_id ON tenant_members(user_id);
CREATE INDEX IF NOT EXISTS idx_blueprints_sector ON blueprints(sector);
CREATE INDEX IF NOT EXISTS idx_blueprints_schema ON blueprints USING GIN (schema);
CREATE INDEX IF NOT EXISTS idx_apps_tenant_id ON apps(tenant_id);
CREATE INDEX IF NOT EXISTS idx_apps_blueprint_id ON apps(blueprint_id);
CREATE INDEX IF NOT EXISTS idx_apps_slug ON apps(slug);
CREATE INDEX IF NOT EXISTS idx_apps_client_email ON apps(client_email);
CREATE INDEX IF NOT EXISTS idx_apps_expires_at ON apps(expires_at);
CREATE INDEX IF NOT EXISTS idx_apps_is_active ON apps(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_apps_client_active ON apps(client_active) WHERE client_active = true;
CREATE INDEX IF NOT EXISTS idx_app_definitions_app_id ON app_definitions(app_id);
CREATE INDEX IF NOT EXISTS idx_app_definitions_tenant_id ON app_definitions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_app_definitions_published ON app_definitions(is_published) WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_app_definitions_schema ON app_definitions USING GIN (schema);
CREATE INDEX IF NOT EXISTS idx_app_records_app_id ON app_records(app_id);
CREATE INDEX IF NOT EXISTS idx_app_records_tenant_id ON app_records(tenant_id);
CREATE INDEX IF NOT EXISTS idx_app_records_table_name ON app_records(table_name);
CREATE INDEX IF NOT EXISTS idx_app_records_app_table ON app_records(app_id, table_name);
CREATE INDEX IF NOT EXISTS idx_app_records_data ON app_records USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_id ON subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription_id ON subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- ============================================================================
-- FASE 5: RLS - Abilita
-- ============================================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE blueprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- FASE 6: Policy RLS
-- ============================================================================

-- profiles
DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
DROP POLICY IF EXISTS "profiles_delete_own" ON profiles;
DROP POLICY IF EXISTS "Users view own profile" ON profiles;
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "profiles_delete_own" ON profiles FOR DELETE USING (user_id = auth.uid());

-- tenants
DROP POLICY IF EXISTS "tenants_select_member" ON tenants;
DROP POLICY IF EXISTS "tenants_insert_authenticated" ON tenants;
DROP POLICY IF EXISTS "tenants_update_owner" ON tenants;
DROP POLICY IF EXISTS "tenants_delete_owner" ON tenants;
DROP POLICY IF EXISTS "Tenant members view their tenants" ON tenants;
DROP POLICY IF EXISTS "Tenant owners can update their tenants" ON tenants;
DROP POLICY IF EXISTS "Tenant owners can delete their tenants" ON tenants;
DROP POLICY IF EXISTS "Authenticated users can insert tenants" ON tenants;
CREATE POLICY "tenants_select_member" ON tenants FOR SELECT USING (id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "tenants_insert_authenticated" ON tenants FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND owner_id = auth.uid());
CREATE POLICY "tenants_update_owner" ON tenants FOR UPDATE USING (id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role = 'owner')) WITH CHECK (id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role = 'owner'));
CREATE POLICY "tenants_delete_owner" ON tenants FOR DELETE USING (id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role = 'owner'));

-- tenant_members
DROP POLICY IF EXISTS "tenant_members_select_own" ON tenant_members;
DROP POLICY IF EXISTS "tenant_members_insert_owner" ON tenant_members;
DROP POLICY IF EXISTS "tenant_members_update_owner" ON tenant_members;
DROP POLICY IF EXISTS "tenant_members_delete_owner" ON tenant_members;
DROP POLICY IF EXISTS "Users view their own memberships" ON tenant_members;
DROP POLICY IF EXISTS "Tenant owners can manage members" ON tenant_members;
CREATE POLICY "tenant_members_select_own" ON tenant_members FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "tenant_members_insert_owner" ON tenant_members FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role = 'owner'));
CREATE POLICY "tenant_members_update_owner" ON tenant_members FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role = 'owner')) WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role = 'owner'));
CREATE POLICY "tenant_members_delete_owner" ON tenant_members FOR DELETE USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role = 'owner'));

-- blueprints
DROP POLICY IF EXISTS "blueprints_select_public" ON blueprints;
DROP POLICY IF EXISTS "blueprints_insert_authenticated" ON blueprints;
DROP POLICY IF EXISTS "blueprints_update_authenticated" ON blueprints;
DROP POLICY IF EXISTS "blueprints_delete_authenticated" ON blueprints;
DROP POLICY IF EXISTS "Everyone can view blueprints" ON blueprints;
DROP POLICY IF EXISTS "Service role can manage blueprints" ON blueprints;
CREATE POLICY "blueprints_select_public" ON blueprints FOR SELECT USING (true);
CREATE POLICY "blueprints_insert_authenticated" ON blueprints FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "blueprints_update_authenticated" ON blueprints FOR UPDATE USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "blueprints_delete_authenticated" ON blueprints FOR DELETE USING (auth.uid() IS NOT NULL);

-- apps
DROP POLICY IF EXISTS "apps_select_tenant_member" ON apps;
DROP POLICY IF EXISTS "apps_insert_tenant_member" ON apps;
DROP POLICY IF EXISTS "apps_update_tenant_member" ON apps;
DROP POLICY IF EXISTS "apps_delete_tenant_member" ON apps;
DROP POLICY IF EXISTS "Tenant members access their apps" ON apps;
CREATE POLICY "apps_select_tenant_member" ON apps FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "apps_insert_tenant_member" ON apps FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "apps_update_tenant_member" ON apps FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())) WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "apps_delete_tenant_member" ON apps FOR DELETE USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));

-- app_definitions
DROP POLICY IF EXISTS "app_definitions_select_tenant_member" ON app_definitions;
DROP POLICY IF EXISTS "app_definitions_insert_tenant_member" ON app_definitions;
DROP POLICY IF EXISTS "app_definitions_update_tenant_member" ON app_definitions;
DROP POLICY IF EXISTS "app_definitions_delete_tenant_member" ON app_definitions;
DROP POLICY IF EXISTS "Tenant members access their app definitions" ON app_definitions;
CREATE POLICY "app_definitions_select_tenant_member" ON app_definitions FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "app_definitions_insert_tenant_member" ON app_definitions FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "app_definitions_update_tenant_member" ON app_definitions FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())) WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "app_definitions_delete_tenant_member" ON app_definitions FOR DELETE USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));

-- app_records
DROP POLICY IF EXISTS "app_records_select_tenant_member" ON app_records;
DROP POLICY IF EXISTS "app_records_insert_tenant_member" ON app_records;
DROP POLICY IF EXISTS "app_records_update_tenant_member" ON app_records;
DROP POLICY IF EXISTS "app_records_delete_tenant_member" ON app_records;
DROP POLICY IF EXISTS "Tenant members access their app records" ON app_records;
DROP POLICY IF EXISTS "Users access only their tenant records" ON app_records;
CREATE POLICY "app_records_select_tenant_member" ON app_records FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "app_records_insert_tenant_member" ON app_records FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "app_records_update_tenant_member" ON app_records FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())) WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "app_records_delete_tenant_member" ON app_records FOR DELETE USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));

-- subscriptions
DROP POLICY IF EXISTS "subscriptions_select_tenant_member" ON subscriptions;
DROP POLICY IF EXISTS "subscriptions_insert_service_role" ON subscriptions;
DROP POLICY IF EXISTS "subscriptions_update_service_role" ON subscriptions;
DROP POLICY IF EXISTS "subscriptions_delete_service_role" ON subscriptions;
DROP POLICY IF EXISTS "Tenant members view their subscriptions" ON subscriptions;
DROP POLICY IF EXISTS "Service role manages subscriptions" ON subscriptions;
CREATE POLICY "subscriptions_select_tenant_member" ON subscriptions FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "subscriptions_insert_service_role" ON subscriptions FOR INSERT WITH CHECK (true);
CREATE POLICY "subscriptions_update_service_role" ON subscriptions FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "subscriptions_delete_service_role" ON subscriptions FOR DELETE USING (true);

-- ============================================================================
-- VERIFICA FINALE
-- ============================================================================

DO $$
DECLARE
  tbl TEXT;
  pol_count INT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY['profiles', 'tenants', 'tenant_members', 'blueprints', 'apps', 'app_definitions', 'app_records', 'subscriptions'])
  LOOP
    SELECT COUNT(*) INTO pol_count FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl;
    IF pol_count = 0 THEN
      RAISE WARNING 'ATTENZIONE: Nessuna policy per %', tbl;
    ELSE
      RAISE NOTICE 'OK: % policy per %', pol_count, tbl;
    END IF;
  END LOOP;
END $$;