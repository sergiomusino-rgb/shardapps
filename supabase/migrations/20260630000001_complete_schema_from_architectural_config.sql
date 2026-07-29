-- ============================================================================
-- ZeusX - Script SQL Completo generato da architectural-config.json
-- Data: 2026-06-30
-- Compatibilità: Supabase (PostgreSQL 15+)
-- Descrizione: Crea tutte le tabelle, policy RLS, trigger, indici e seed data
-- ============================================================================

-- ============================================================================
-- FUNZIONI DI UTILITÀ
-- ============================================================================

-- Funzione per aggiornare automaticamente il campo updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Funzione per creare il profilo automatico al primo accesso
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_tenant_id UUID;
  user_email TEXT;
BEGIN
  -- Inserisci il profilo utente
  INSERT INTO public.profiles (user_id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (user_id) DO NOTHING;

  -- Ottieni l'email dell'utente per il nome del tenant
  user_email := NEW.email;

  -- Crea un nuovo tenant di default per l'utente
  INSERT INTO public.tenants (owner_id, name, slug)
  VALUES (NEW.id, user_email || '''s Workspace', REPLACE(user_email, '@', '-') || '-workspace') -- Esempio di nome e slug
  RETURNING id INTO new_tenant_id;

  -- Aggiungi l'utente come owner del nuovo tenant
  INSERT INTO public.tenant_members (tenant_id, user_id, role)
  VALUES (new_tenant_id, NEW.id, 'owner');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funzione per sincronizzare schema da apps.config a app_definitions
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

-- ============================================================================
-- 1. TABELLA: profiles
-- ============================================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE profiles IS 'Profili utente pubblici associati a Supabase Auth. Creati automaticamente al primo accesso.';
COMMENT ON COLUMN profiles.user_id IS 'Riferimento all''utente Supabase Auth (1:1)';
COMMENT ON COLUMN profiles.email IS 'Email dell''utente (sincronizzata da auth.users)';
COMMENT ON COLUMN profiles.full_name IS 'Nome completo visualizzato dell''utente';

-- Trigger updated_at
DROP TRIGGER IF EXISTS tr_profiles_updated_at ON profiles;
CREATE TRIGGER tr_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger auto-creazione profilo su nuovo utente
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- 2. TABELLA: tenants
-- ============================================================================
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'starter', 'pro', 'business')),
  app_limit INT NOT NULL DEFAULT 1,
  total_apps_created INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE tenants IS 'Organizzazioni/workspace multi-tenant. Ogni utente può appartenere a uno o più tenant.';
COMMENT ON COLUMN tenants.owner_id IS 'Utente proprietario del tenant (creatore)';
COMMENT ON COLUMN tenants.name IS 'Nome dell''organizzazione/tenant';
COMMENT ON COLUMN tenants.slug IS 'Slug univoco per URL e riferimenti';
COMMENT ON COLUMN tenants.plan IS 'Piano di abbonamento: free, starter, pro, business';
COMMENT ON COLUMN tenants.app_limit IS 'Numero massimo di app attive creabili';
COMMENT ON COLUMN tenants.total_apps_created IS 'Contatore permanente di tutte le app create (non decrementa mai)';

-- Trigger updated_at
DROP TRIGGER IF EXISTS tr_tenants_updated_at ON tenants;
CREATE TRIGGER tr_tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Indice su slug per lookup veloce
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_owner_id ON tenants(owner_id);

-- ============================================================================
-- 3. TABELLA: tenant_members
-- ============================================================================
CREATE TABLE IF NOT EXISTS tenant_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);

COMMENT ON TABLE tenant_members IS 'Associazione molti-a-molti tra utenti e tenant con ruolo.';
COMMENT ON COLUMN tenant_members.tenant_id IS 'Riferimento al tenant';
COMMENT ON COLUMN tenant_members.user_id IS 'Riferimento all''utente';
COMMENT ON COLUMN tenant_members.role IS 'Ruolo nel tenant: owner, admin, member';

-- Indici per query frequenti
CREATE INDEX IF NOT EXISTS idx_tenant_members_tenant_id ON tenant_members(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_members_user_id ON tenant_members(user_id);

-- ============================================================================
-- 4. TABELLA: blueprints
-- ============================================================================
CREATE TABLE IF NOT EXISTS blueprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sector TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  ui_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE blueprints IS 'Catalogo di template/blueprint per settori merceologici. Ogni blueprint definisce lo schema dati e la UI di un''app.';
COMMENT ON COLUMN blueprints.sector IS 'Settore in kebab-case (es. oculista, officina, ristorante)';
COMMENT ON COLUMN blueprints.display_name IS 'Nome visualizzato del settore (es. Studio Oculistico)';
COMMENT ON COLUMN blueprints.description IS 'Descrizione del gestionale per questo settore';
COMMENT ON COLUMN blueprints.schema IS 'Schema JSON con definizione tabelle, campi, tipi, relazioni';
COMMENT ON COLUMN blueprints.ui_config IS 'Configurazione UI: primaryColor, sidebar, dashboardCards';

-- Trigger updated_at
DROP TRIGGER IF EXISTS tr_blueprints_updated_at ON blueprints;
CREATE TRIGGER tr_blueprints_updated_at
  BEFORE UPDATE ON blueprints
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Indici
CREATE INDEX IF NOT EXISTS idx_blueprints_sector ON blueprints(sector);
CREATE INDEX IF NOT EXISTS idx_blueprints_schema ON blueprints USING GIN (schema);

-- ============================================================================
-- 5. TABELLA: apps
-- ============================================================================
CREATE TABLE IF NOT EXISTS apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  blueprint_id UUID REFERENCES blueprints(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  client_password TEXT,
  client_email TEXT,
  client_active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,
  expiry_warning_sent BOOLEAN NOT NULL DEFAULT false,
  trial_ends_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE apps IS 'App generate dagli utenti a partire dai blueprint. Contiene la configurazione completa e i dati di accesso client.';
COMMENT ON COLUMN apps.tenant_id IS 'Tenant proprietario dell''app';
COMMENT ON COLUMN apps.blueprint_id IS 'Blueprint di origine (può essere NULL se generato da AI)';
COMMENT ON COLUMN apps.name IS 'Nome dell''app';
COMMENT ON COLUMN apps.slug IS 'Slug univoco per URL pubblico (/a/:slug)';
COMMENT ON COLUMN apps.config IS 'Configurazione completa: schema, ui, blueprint, branding, logo, prompt';
COMMENT ON COLUMN apps.client_password IS 'Password per accesso client all''app pubblica';
COMMENT ON COLUMN apps.client_email IS 'Email del cliente principale associato all''app';
COMMENT ON COLUMN apps.client_active IS 'Se true, l''app è attiva e accessibile ai clienti';
COMMENT ON COLUMN apps.expires_at IS 'Data di scadenza dell''abbonamento dell''app';
COMMENT ON COLUMN apps.expiry_warning_sent IS 'Flag: avviso di scadenza già inviato al cliente';
COMMENT ON COLUMN apps.trial_ends_at IS 'Data fine del periodo di prova (default 30 giorni dalla creazione)';
COMMENT ON COLUMN apps.is_active IS 'Se false, l''app è disattivata (non accessibile)';

-- Trigger updated_at
DROP TRIGGER IF EXISTS tr_apps_updated_at ON apps;
CREATE TRIGGER tr_apps_updated_at
  BEFORE UPDATE ON apps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Indici
CREATE INDEX IF NOT EXISTS idx_apps_tenant_id ON apps(tenant_id);
CREATE INDEX IF NOT EXISTS idx_apps_blueprint_id ON apps(blueprint_id);
CREATE INDEX IF NOT EXISTS idx_apps_slug ON apps(slug);
CREATE INDEX IF NOT EXISTS idx_apps_client_email ON apps(client_email);
CREATE INDEX IF NOT EXISTS idx_apps_expires_at ON apps(expires_at);
CREATE INDEX IF NOT EXISTS idx_apps_is_active ON apps(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_apps_client_active ON apps(client_active) WHERE client_active = true;

-- ============================================================================
-- 6. TABELLA: app_definitions
-- ============================================================================
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

COMMENT ON TABLE app_definitions IS 'Definizioni di schema e UI per app generate, separato dalla config per versioning e caching.';
COMMENT ON COLUMN app_definitions.app_id IS 'Riferimento all''app (1:1)';
COMMENT ON COLUMN app_definitions.tenant_id IS 'Riferimento al tenant per RLS';
COMMENT ON COLUMN app_definitions.schema IS 'Schema JSON con definizione tabelle, campi, tipi, relazioni';
COMMENT ON COLUMN app_definitions.ui_config IS 'Configurazione UI: colori, layout, sidebar, dashboard cards';
COMMENT ON COLUMN app_definitions.version IS 'Versione incrementale dello schema per tracciare modifiche';
COMMENT ON COLUMN app_definitions.is_published IS 'Se true, la definizione è pubblicata e visibile ai client dell''app';

-- Trigger updated_at
DROP TRIGGER IF EXISTS tr_app_definitions_updated_at ON app_definitions;
CREATE TRIGGER tr_app_definitions_updated_at
  BEFORE UPDATE ON app_definitions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger auto-sync da apps.config a app_definitions
DROP TRIGGER IF EXISTS tr_apps_sync_definition ON apps;
CREATE TRIGGER tr_apps_sync_definition
  AFTER INSERT ON apps
  FOR EACH ROW EXECUTE FUNCTION sync_app_definition_from_config();

-- Indici
CREATE INDEX IF NOT EXISTS idx_app_definitions_app_id ON app_definitions(app_id);
CREATE INDEX IF NOT EXISTS idx_app_definitions_tenant_id ON app_definitions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_app_definitions_published ON app_definitions(is_published) WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_app_definitions_schema ON app_definitions USING GIN (schema);

-- ============================================================================
-- 7. TABELLA: app_records
-- ============================================================================
CREATE TABLE IF NOT EXISTS app_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE app_records IS 'Storage ibrido JSONB per i record delle app generate. Ogni riga rappresenta un record di una tabella dinamica.';
COMMENT ON COLUMN app_records.app_id IS 'Riferimento all''app proprietaria';
COMMENT ON COLUMN app_records.tenant_id IS 'Riferimento al tenant per RLS e isolamento';
COMMENT ON COLUMN app_records.table_name IS 'Nome della tabella logica (es. patients, appointments, vehicles)';
COMMENT ON COLUMN app_records.data IS 'Dati del record in formato JSONB, struttura adattiva allo schema del blueprint';

-- Trigger updated_at
DROP TRIGGER IF EXISTS tr_app_records_updated_at ON app_records;
CREATE TRIGGER tr_app_records_updated_at
  BEFORE UPDATE ON app_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Indici per performance
CREATE INDEX IF NOT EXISTS idx_app_records_app_id ON app_records(app_id);
CREATE INDEX IF NOT EXISTS idx_app_records_tenant_id ON app_records(tenant_id);
CREATE INDEX IF NOT EXISTS idx_app_records_table_name ON app_records(table_name);
CREATE INDEX IF NOT EXISTS idx_app_records_app_table ON app_records(app_id, table_name);
CREATE INDEX IF NOT EXISTS idx_app_records_data ON app_records USING GIN (data);

-- ============================================================================
-- 8. TABELLA: subscriptions
-- ============================================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'incomplete' CHECK (status IN ('free', 'starter', 'pro', 'business', 'incomplete', 'active', 'past_due', 'canceled', 'trialing')),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE subscriptions IS 'Abbonamenti Stripe associati ai tenant. Relazione 1:1 con tenants.';
COMMENT ON COLUMN subscriptions.tenant_id IS 'Riferimento al tenant (UNIQUE: 1:1)';
COMMENT ON COLUMN subscriptions.stripe_customer_id IS 'ID cliente Stripe (cus_xxx)';
COMMENT ON COLUMN subscriptions.stripe_subscription_id IS 'ID subscription Stripe (sub_xxx)';
COMMENT ON COLUMN subscriptions.status IS 'Stato subscription: incomplete, active, past_due, canceled, trialing';
COMMENT ON COLUMN subscriptions.current_period_start IS 'Inizio del periodo di fatturazione corrente';
COMMENT ON COLUMN subscriptions.current_period_end IS 'Fine del periodo di fatturazione corrente';

-- Trigger updated_at
DROP TRIGGER IF EXISTS tr_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER tr_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Indici
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_id ON subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription_id ON subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Abilita RLS su tutte le tabelle
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE blueprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- POLICY RLS: profiles
-- ============================================================================

DROP POLICY IF EXISTS "Users view own profile" ON profiles;
CREATE POLICY "Users view own profile" ON profiles
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- POLICY RLS: tenants
-- I membri del tenant possono vedere il proprio tenant
-- ============================================================================

DROP POLICY IF EXISTS "Tenant members view their tenants" ON tenants;
CREATE POLICY "Tenant members view their tenants" ON tenants
  FOR SELECT
  USING (
    id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Tenant owners can update their tenants" ON tenants;
CREATE POLICY "Tenant owners can update their tenants" ON tenants
  FOR UPDATE
  USING (
    id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role = 'owner'
    )
  )
  WITH CHECK (
    id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

DROP POLICY IF EXISTS "Tenant owners can delete their tenants" ON tenants;
CREATE POLICY "Tenant owners can delete their tenants" ON tenants
  FOR DELETE
  USING (
    id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

DROP POLICY IF EXISTS "Authenticated users can insert tenants" ON tenants;
CREATE POLICY "Authenticated users can insert tenants" ON tenants
  FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

-- ============================================================================
-- POLICY RLS: tenant_members
-- ============================================================================

DROP POLICY IF EXISTS "Users view their own memberships" ON tenant_members;
CREATE POLICY "Users view their own memberships" ON tenant_members
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Tenant owners can manage members" ON tenant_members;
CREATE POLICY "Tenant owners can manage members" ON tenant_members
  FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role = 'owner'
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- ============================================================================
-- POLICY RLS: blueprints
-- I blueprint sono pubblici in lettura, solo admin possono modificarli
-- ============================================================================

DROP POLICY IF EXISTS "Everyone can view blueprints" ON blueprints;
CREATE POLICY "Everyone can view blueprints" ON blueprints
  FOR SELECT
  USING (true);

-- Policy per inserimento/modifica blueprint (placeholder: in produzione va ristretta)
DROP POLICY IF EXISTS "Service role can manage blueprints" ON blueprints;
CREATE POLICY "Service role can manage blueprints" ON blueprints
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- POLICY RLS: apps
-- Solo i membri del tenant proprietario possono accedere alle app
-- ============================================================================

DROP POLICY IF EXISTS "Tenant members access their apps" ON apps;
CREATE POLICY "Tenant members access their apps" ON apps
  FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()
    )
  );

-- ============================================================================
-- POLICY RLS: app_definitions
-- Solo i membri del tenant proprietario possono accedere alle definizioni
-- ============================================================================

DROP POLICY IF EXISTS "Tenant members access their app definitions" ON app_definitions;
CREATE POLICY "Tenant members access their app definitions" ON app_definitions
  FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()
    )
  );

-- ============================================================================
-- POLICY RLS: app_records
-- Solo i membri del tenant proprietario possono accedere ai record
-- ============================================================================

DROP POLICY IF EXISTS "Tenant members access their app records" ON app_records;
CREATE POLICY "Tenant members access their app records" ON app_records
  FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()
    )
  );

-- ============================================================================
-- POLICY RLS: subscriptions
-- Solo i membri del tenant proprietario possono vedere gli abbonamenti
-- ============================================================================

DROP POLICY IF EXISTS "Tenant members view their subscriptions" ON subscriptions;
CREATE POLICY "Tenant members view their subscriptions" ON subscriptions
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role manages subscriptions" ON subscriptions;
CREATE POLICY "Service role manages subscriptions" ON subscriptions
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- SEED DATA: Blueprint di esempio
-- ============================================================================

-- Blueprint: Studio Oculistico
INSERT INTO blueprints (sector, display_name, description, schema, ui_config)
VALUES (
  'oculista',
  'Studio Oculistico',
  'Gestionale per studi oculistici: pazienti, appuntamenti, refrazioni, prescrizioni lenti.',
  '{"tables": [{"name": "patients", "label": "Paziente", "labelPlural": "Pazienti", "icon": "👁️", "fields": [{"id": "first_name", "type": "text", "label": "Nome", "required": true}, {"id": "last_name", "type": "text", "label": "Cognome", "required": true}, {"id": "phone", "type": "phone", "label": "Telefono", "required": false}, {"id": "email", "type": "email", "label": "Email", "required": false}, {"id": "birth_date", "type": "date", "label": "Data di nascita", "required": false}]}, {"name": "appointments", "label": "Appuntamento", "labelPlural": "Appuntamenti", "icon": "📅", "fields": [{"id": "patient_id", "type": "relation", "label": "Paziente", "target": "patients", "targetLabel": "last_name", "required": true}, {"id": "date", "type": "datetime", "label": "Data e ora", "required": true}, {"id": "type", "type": "select", "label": "Tipo visita", "options": ["Prima visita", "Controllo", "Urgenza", "Lenti a contatto"], "required": true}, {"id": "notes", "type": "textarea", "label": "Note", "required": false}]}]}',
  '{"primaryColor": "#6366f1", "sidebar": ["patients", "appointments"], "dashboardCards": [{"type": "count", "table": "patients", "label": "Pazienti totali"}, {"type": "count", "table": "appointments", "label": "Appuntamenti oggi"}]}'
)
ON CONFLICT (sector) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  schema = EXCLUDED.schema,
  ui_config = EXCLUDED.ui_config,
  updated_at = NOW();

-- Blueprint: Officina Meccanica
INSERT INTO blueprints (sector, display_name, description, schema, ui_config)
VALUES (
  'officina',
  'Officina Meccanica',
  'Gestionale per officine: clienti, veicoli, lavorazioni, preventivi, fatture.',
  '{"tables": [{"name": "customers", "label": "Cliente", "labelPlural": "Clienti", "icon": "👤", "fields": [{"id": "name", "type": "text", "label": "Ragione Sociale", "required": true}, {"id": "phone", "type": "phone", "label": "Telefono", "required": false}, {"id": "email", "type": "email", "label": "Email", "required": false}, {"id": "address", "type": "textarea", "label": "Indirizzo", "required": false}]}, {"name": "vehicles", "label": "Veicolo", "labelPlural": "Veicoli", "icon": "🚗", "fields": [{"id": "customer_id", "type": "relation", "label": "Cliente", "target": "customers", "targetLabel": "name", "required": true}, {"id": "plate", "type": "text", "label": "Targa", "required": true}, {"id": "brand", "type": "text", "label": "Marca", "required": false}, {"id": "model", "type": "text", "label": "Modello", "required": false}, {"id": "year", "type": "number", "label": "Anno", "required": false}]}, {"name": "jobs", "label": "Lavorazione", "labelPlural": "Lavorazioni", "icon": "🔧", "fields": [{"id": "vehicle_id", "type": "relation", "label": "Veicolo", "target": "vehicles", "targetLabel": "plate", "required": true}, {"id": "description", "type": "textarea", "label": "Descrizione", "required": true}, {"id": "status", "type": "select", "label": "Stato", "options": ["In attesa", "In corso", "Completata", "Consegnata"], "required": true}, {"id": "cost", "type": "currency", "label": "Costo", "required": false}]}]}',
  '{"primaryColor": "#f59e0b", "sidebar": ["customers", "vehicles", "jobs"], "dashboardCards": [{"type": "count", "table": "customers", "label": "Clienti"}, {"type": "count", "table": "jobs", "label": "Lavorazioni in corso"}]}'
)
ON CONFLICT (sector) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  schema = EXCLUDED.schema,
  ui_config = EXCLUDED.ui_config,
  updated_at = NOW();

-- Blueprint: Ristorante
INSERT INTO blueprints (sector, display_name, description, schema, ui_config)
VALUES (
  'ristorante',
  'Ristorante',
  'Gestionale per ristoranti: menu, ordini, prenotazioni, fornitori.',
  '{"tables": [{"name": "dishes", "label": "Piatto", "labelPlural": "Menu", "icon": "🍽️", "fields": [{"id": "name", "type": "text", "label": "Nome piatto", "required": true}, {"id": "category", "type": "select", "label": "Categoria", "options": ["Antipasti", "Primi", "Secondi", "Contorni", "Dolci", "Bevande"], "required": true}, {"id": "price", "type": "currency", "label": "Prezzo", "required": true}, {"id": "description", "type": "textarea", "label": "Descrizione", "required": false}]}, {"name": "reservations", "label": "Prenotazione", "labelPlural": "Prenotazioni", "icon": "📅", "fields": [{"id": "customer_name", "type": "text", "label": "Nome cliente", "required": true}, {"id": "phone", "type": "phone", "label": "Telefono", "required": true}, {"id": "date", "type": "datetime", "label": "Data e ora", "required": true}, {"id": "guests", "type": "number", "label": "Numero ospiti", "required": true}, {"id": "notes", "type": "textarea", "label": "Note", "required": false}]}]}',
  '{"primaryColor": "#ef4444", "sidebar": ["dishes", "reservations"], "dashboardCards": [{"type": "count", "table": "dishes", "label": "Piatti nel menu"}, {"type": "count", "table": "reservations", "label": "Prenotazioni oggi"}]}'
)
ON CONFLICT (sector) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  schema = EXCLUDED.schema,
  ui_config = EXCLUDED.ui_config,
  updated_at = NOW();

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
