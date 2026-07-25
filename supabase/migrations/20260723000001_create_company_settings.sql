-- ─── MIGRAZIONE: company_settings ──────────────────────────────────────────────
-- Crea la tabella globale "company_settings" per permettere ai clienti finali
-- di configurare dinamicamente i dati aziendali (Nome Azienda, Logo, P.IVA, ecc.)
-- senza hardcoding nei componenti.

-- 1. Crea la tabella company_settings
CREATE TABLE IF NOT EXISTS company_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  company_name TEXT DEFAULT '',
  logo_url TEXT DEFAULT '',
  header_text TEXT DEFAULT '',
  vat_number TEXT DEFAULT '',
  address TEXT DEFAULT '',
  zip_code TEXT DEFAULT '',
  city TEXT DEFAULT '',
  province TEXT DEFAULT '',
  fiscal_code TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  website TEXT DEFAULT '',
  slogan TEXT DEFAULT '',
  footer_notes TEXT DEFAULT '',
  accent_color TEXT DEFAULT '#6366f1',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(app_id)
);

-- 2. Abilita RLS
ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;

-- 3. Policy: lettura pubblica per l'app client (tramite app_id/slug)
CREATE POLICY "company_settings_select_public" ON company_settings
  FOR SELECT
  USING (
    app_id IN (
      SELECT id FROM apps WHERE client_active = true
    )
  );

-- 4. Policy: scrittura solo per admin del tenant (tramite tenant_members)
CREATE POLICY "company_settings_upsert_tenant_admin" ON company_settings
  FOR ALL
  USING (
    app_id IN (
      SELECT a.id FROM apps a
      JOIN tenant_members tm ON tm.tenant_id = a.tenant_id
      WHERE tm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    app_id IN (
      SELECT a.id FROM apps a
      JOIN tenant_members tm ON tm.tenant_id = a.tenant_id
      WHERE tm.user_id = auth.uid()
    )
  );

-- 5. Trigger per aggiornare updated_at automaticamente
CREATE OR REPLACE FUNCTION update_company_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_company_settings_updated_at ON company_settings;
CREATE TRIGGER trg_company_settings_updated_at
  BEFORE UPDATE ON company_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_company_settings_updated_at();

-- 6. Inserisci un record di default per ogni app esistente
INSERT INTO company_settings (app_id, company_name)
SELECT id, name FROM apps
WHERE id NOT IN (SELECT app_id FROM company_settings)
ON CONFLICT (app_id) DO NOTHING;

-- 7. Trigger: alla creazione di una nuova app, crea anche company_settings
CREATE OR REPLACE FUNCTION create_default_company_settings()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO company_settings (app_id, company_name)
  VALUES (NEW.id, NEW.name)
  ON CONFLICT (app_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_create_company_settings_on_app_insert ON apps;
CREATE TRIGGER trg_create_company_settings_on_app_insert
  AFTER INSERT ON apps
  FOR EACH ROW
  EXECUTE FUNCTION create_default_company_settings();

-- 8. Permetti al service role di bypassare RLS (per il backend)
-- (già abilitato di default per il service_role)

COMMENT ON TABLE company_settings IS 'Impostazioni aziendali dinamiche per ogni app. I dati vengono letti dinamicamente dal database, vietato hardcoding nei componenti.';
COMMENT ON COLUMN company_settings.company_name IS 'Nome Azienda/Ditta - modificabile dal cliente';
COMMENT ON COLUMN company_settings.logo_url IS 'URL del logo aziendale';
COMMENT ON COLUMN company_settings.vat_number IS 'Partita IVA';
COMMENT ON COLUMN company_settings.address IS 'Indirizzo della sede';
COMMENT ON COLUMN company_settings.header_text IS 'Testo per intestazione documenti';