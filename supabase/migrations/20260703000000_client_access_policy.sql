-- Policy per permettere l'accesso pubblico alle app attive per i clienti
-- Questo permette alla pagina di login pubblica di leggere i dati dell'app

-- Abilita RLS se non già abilitata
ALTER TABLE IF EXISTS apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS app_definitions ENABLE ROW LEVEL SECURITY;

-- Policy per lettura pubblica delle app attive (per login clienti)
DROP POLICY IF EXISTS "apps_select_public_active" ON apps;
CREATE POLICY "apps_select_public_active" ON apps 
  FOR SELECT 
  USING (client_active = true);

-- Policy per lettura pubblica di app_definitions per i clienti
DROP POLICY IF EXISTS "app_definitions_select_public" ON app_definitions;
CREATE POLICY "app_definitions_select_public" ON app_definitions 
  FOR SELECT 
  USING (
    app_id IN (SELECT id FROM apps WHERE client_active = true)
  );
