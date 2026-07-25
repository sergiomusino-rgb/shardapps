-- Migrazione adattiva: aggiunge colonne/tabelle mancanti preservando dati esistenti

-- ============================================================
-- 1. TABELLA profiles
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Trigger profilo automatico
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created') THEN
    CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END $$;

-- ============================================================
-- 2. TABELLA tenants (colonne mancanti)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'owner_id') THEN
    ALTER TABLE tenants ADD COLUMN owner_id UUID REFERENCES auth.users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'name') THEN
    ALTER TABLE tenants ADD COLUMN name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'slug') THEN
    ALTER TABLE tenants ADD COLUMN slug TEXT UNIQUE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'plan') THEN
    ALTER TABLE tenants ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'app_limit') THEN
    ALTER TABLE tenants ADD COLUMN app_limit INT NOT NULL DEFAULT 5;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'updated_at') THEN
    ALTER TABLE tenants ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
  END IF;
END $$;

-- ============================================================
-- 3. TABELLA tenant_members (colonne mancanti)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenant_members' AND column_name = 'role') THEN
    ALTER TABLE tenant_members ADD COLUMN role TEXT NOT NULL DEFAULT 'member';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenant_members' AND column_name = 'created_at') THEN
    ALTER TABLE tenant_members ADD COLUMN created_at TIMESTAMPTZ DEFAULT now();
  END IF;
END $$;

-- Aggiungi constraint su role se non esiste
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.constraint_column_usage WHERE constraint_name = 'tenant_members_role_check') THEN
    ALTER TABLE tenant_members ADD CONSTRAINT tenant_members_role_check CHECK (role IN ('owner', 'admin', 'member'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- ============================================================
-- 4. TABELLA blueprints
-- ============================================================
CREATE TABLE IF NOT EXISTS blueprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sector TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  schema JSONB NOT NULL DEFAULT '{}',
  ui_config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 5. TABELLA apps
-- ============================================================
CREATE TABLE IF NOT EXISTS apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  blueprint_id UUID REFERENCES blueprints(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  trial_ends_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 6. TABELLA subscriptions
-- ============================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'incomplete',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 7. Trigger updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_tenants_updated_at') THEN
    CREATE TRIGGER tr_tenants_updated_at BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_apps_updated_at') THEN
    CREATE TRIGGER tr_apps_updated_at BEFORE UPDATE ON apps
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_subscriptions_updated_at') THEN
    CREATE TRIGGER tr_subscriptions_updated_at BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- ============================================================
-- 8. RLS e policy
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE blueprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Policy apps obbligatoria
DROP POLICY IF EXISTS "Users access only their tenant apps" ON apps;
CREATE POLICY "Users access only their tenant apps" ON apps
  FOR ALL USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users view own profile" ON profiles;
CREATE POLICY "Users view own profile" ON profiles
  FOR ALL USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Tenant members view tenants" ON tenants;
CREATE POLICY "Tenant members view tenants" ON tenants
  FOR ALL USING (
    id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Tenant members view memberships" ON tenant_members;
CREATE POLICY "Tenant members view memberships" ON tenant_members
  FOR ALL USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Everyone view blueprints" ON blueprints;
CREATE POLICY "Everyone view blueprints" ON blueprints
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Tenant owners view subscriptions" ON subscriptions;
CREATE POLICY "Tenant owners view subscriptions" ON subscriptions
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())
  );

-- ============================================================
-- 9. Seed blueprint di esempio
-- ============================================================
INSERT INTO blueprints (sector, display_name, description, schema, ui_config)
VALUES (
  'oculista',
  'Studio Oculistico',
  'Gestionale per studi oculistici: pazienti, appuntamenti, refrazioni, prescrizioni lenti.',
  '{"tables": [{"name": "patients", "label": "Paziente", "labelPlural": "Pazienti", "fields": [{"id": "first_name", "type": "text", "label": "Nome", "required": true}, {"id": "last_name", "type": "text", "label": "Cognome", "required": true}, {"id": "phone", "type": "phone", "label": "Telefono", "required": false}, {"id": "email", "type": "email", "label": "Email", "required": false}]}, {"name": "appointments", "label": "Appuntamento", "labelPlural": "Appuntamenti", "fields": [{"id": "patient_id", "type": "relation", "label": "Paziente", "target": "patients", "targetLabel": "last_name", "required": true}, {"id": "date", "type": "datetime", "label": "Data e ora", "required": true}, {"id": "notes", "type": "textarea", "label": "Note", "required": false}]}]}',
  '{"primaryColor": "#6366f1", "sidebar": ["patients", "appointments"], "dashboardCards": [{"type": "count", "table": "patients", "label": "Pazienti totali"}, {"type": "count", "table": "appointments", "label": "Appuntamenti oggi"}]}'
)
ON CONFLICT (sector) DO NOTHING;

INSERT INTO blueprints (sector, display_name, description, schema, ui_config)
VALUES (
  'officina',
  'Officina Meccanica',
  'Gestionale per officine: clienti, veicoli, lavorazioni, preventivi, fatture.',
  '{"tables": [{"name": "customers", "label": "Cliente", "labelPlural": "Clienti", "fields": [{"id": "name", "type": "text", "label": "Ragione Sociale", "required": true}, {"id": "phone", "type": "phone", "label": "Telefono", "required": false}, {"id": "email", "type": "email", "label": "Email", "required": false}]}, {"name": "vehicles", "label": "Veicolo", "labelPlural": "Veicoli", "fields": [{"id": "customer_id", "type": "relation", "label": "Cliente", "target": "customers", "targetLabel": "name", "required": true}, {"id": "plate", "type": "text", "label": "Targa", "required": true}, {"id": "brand", "type": "text", "label": "Marca", "required": false}, {"id": "model", "type": "text", "label": "Modello", "required": false}]}, {"name": "jobs", "label": "Lavorazione", "labelPlural": "Lavorazioni", "fields": [{"id": "vehicle_id", "type": "relation", "label": "Veicolo", "target": "vehicles", "targetLabel": "plate", "required": true}, {"id": "description", "type": "textarea", "label": "Descrizione", "required": true}, {"id": "cost", "type": "currency", "label": "Costo", "required": false}]}]}',
  '{"primaryColor": "#f59e0b", "sidebar": ["customers", "vehicles", "jobs"], "dashboardCards": [{"type": "count", "table": "customers", "label": "Clienti"}, {"type": "count", "table": "jobs", "label": "Lavorazioni in corso"}]}'
)
ON CONFLICT (sector) DO NOTHING;
