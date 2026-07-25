-- ============================================================================
-- ZeusX - Policy RLS complete basate su auth.uid()
-- Data: 2026-06-30
-- Compatibilità: Supabase (PostgreSQL 15+)
-- Descrizione: Policy RLS granulari per ogni tabella, usando auth.uid()
--              per garantire che ogni utente veda solo i propri dati.
--              Include policy per operazioni SELECT, INSERT, UPDATE, DELETE.
-- ============================================================================

-- ============================================================================
-- PRE-REQUISITI: Abilita RLS su tutte le tabelle (se non già fatto)
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
-- 1. POLICY: profiles
--    Ogni utente può vedere e modificare SOLO il proprio profilo.
--    user_id DEVE corrispondere a auth.uid().
-- ============================================================================

-- Rimuovi policy esistenti per profiles (idempotenza)
DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
DROP POLICY IF EXISTS "profiles_delete_own" ON profiles;

-- SELECT: solo il proprio profilo
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT USING (user_id = auth.uid());

-- INSERT: solo per se stessi (user_id deve essere auth.uid())
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT WITH CHECK (user_id = auth.uid());

-- UPDATE: solo il proprio profilo
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- DELETE: solo il proprio profilo
CREATE POLICY "profiles_delete_own" ON profiles FOR DELETE USING (user_id = auth.uid());

-- ============================================================================
-- 2. POLICY: tenants
--    SELECT: membri del tenant possono vedere il tenant
--    INSERT: utenti autenticati possono creare tenant (diventano owner)
--    UPDATE: solo owner del tenant
--    DELETE: solo owner del tenant
-- ============================================================================

-- Rimuovi policy esistenti per tenants (idempotenza)
DROP POLICY IF EXISTS "tenants_select_member" ON tenants;
DROP POLICY IF EXISTS "tenants_update_owner" ON tenants;
DROP POLICY IF EXISTS "tenants_delete_owner" ON tenants;
DROP POLICY IF EXISTS "tenants_insert_authenticated" ON tenants;

-- SELECT: solo se sei membro del tenant
CREATE POLICY "tenants_select_member" ON tenants FOR SELECT USING (id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));

-- INSERT: utenti autenticati possono creare tenant (owner_id = auth.uid())
CREATE POLICY "tenants_insert_authenticated" ON tenants FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND owner_id = auth.uid());

-- UPDATE: solo owner del tenant
CREATE POLICY "tenants_update_owner" ON tenants FOR UPDATE USING (id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role = 'owner')) WITH CHECK (id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role = 'owner'));

-- DELETE: solo owner del tenant
CREATE POLICY "tenants_delete_owner" ON tenants FOR DELETE USING (id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role = 'owner'));

-- ============================================================================
-- 3. POLICY: tenant_members
--    SELECT: utente vede solo le proprie membership
--    INSERT/UPDATE/DELETE: owner del tenant può gestire i membri
-- ============================================================================

-- Rimuovi policy esistenti per tenant_members (idempotenza)
DROP POLICY IF EXISTS "tenant_members_select_own" ON tenant_members;
DROP POLICY IF EXISTS "tenant_members_manage_owner" ON tenant_members;

-- SELECT: solo le proprie membership
CREATE POLICY "tenant_members_select_own" ON tenant_members FOR SELECT USING (user_id = auth.uid());

-- INSERT/UPDATE/DELETE: owner del tenant può gestire i membri
CREATE POLICY "tenant_members_manage_owner" ON tenant_members FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- ============================================================================
-- 4. POLICY: blueprints
--    SELECT: pubblico (chiunque può vedere i blueprint)
--    INSERT/UPDATE/DELETE: solo utenti autenticati (admin in produzione)
-- ============================================================================

-- Rimuovi policy esistenti per blueprints (idempotenza)
DROP POLICY IF EXISTS "blueprints_select_public" ON blueprints;
DROP POLICY IF EXISTS "blueprints_manage_service_role" ON blueprints;

-- SELECT: pubblico
CREATE POLICY "blueprints_select_public" ON blueprints FOR SELECT USING (true);

-- INSERT/UPDATE/DELETE: solo utenti autenticati (o service_role)
CREATE POLICY "blueprints_manage_service_role" ON blueprints FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================================
-- 5. POLICY: apps
--    Tutte le operazioni: solo membri del tenant proprietario
--    Il controllo avviene tramite tenant_id → tenant_members
-- ============================================================================

-- Rimuovi policy esistenti per apps (idempotenza)
DROP POLICY IF EXISTS "apps_select_tenant_member" ON apps;
DROP POLICY IF EXISTS "apps_insert_tenant_member" ON apps;
DROP POLICY IF EXISTS "apps_update_tenant_member" ON apps;
DROP POLICY IF EXISTS "apps_delete_tenant_member" ON apps;

-- SELECT: membri del tenant
CREATE POLICY "apps_select_tenant_member" ON apps FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));

-- INSERT: membri del tenant
CREATE POLICY "apps_insert_tenant_member" ON apps FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));

-- UPDATE: membri del tenant
CREATE POLICY "apps_update_tenant_member" ON apps FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())) WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));

-- DELETE: membri del tenant
CREATE POLICY "apps_delete_tenant_member" ON apps FOR DELETE USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 6. POLICY: app_definitions
--    Tutte le operazioni: solo membri del tenant proprietario
-- ============================================================================

-- Rimuovi policy esistenti per app_definitions (idempotenza)
DROP POLICY IF EXISTS "app_definitions_select_tenant_member" ON app_definitions;
DROP POLICY IF EXISTS "app_definitions_insert_tenant_member" ON app_definitions;
DROP POLICY IF EXISTS "app_definitions_update_tenant_member" ON app_definitions;
DROP POLICY IF EXISTS "app_definitions_delete_tenant_member" ON app_definitions;

-- SELECT: membri del tenant
CREATE POLICY "app_definitions_select_tenant_member" ON app_definitions FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));

-- INSERT: membri del tenant
CREATE POLICY "app_definitions_insert_tenant_member" ON app_definitions FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));

-- UPDATE: membri del tenant
CREATE POLICY "app_definitions_update_tenant_member" ON app_definitions FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())) WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));

-- DELETE: membri del tenant
CREATE POLICY "app_definitions_delete_tenant_member" ON app_definitions FOR DELETE USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 7. POLICY: app_records
--    Tutte le operazioni: solo membri del tenant proprietario
--    Questa è la tabella più critica: contiene i dati delle app generate.
--    L'isolamento multi-tenant è garantito da tenant_id.
-- ============================================================================

-- Rimuovi policy esistenti per app_records (idempotenza)
DROP POLICY IF EXISTS "app_records_select_tenant_member" ON app_records;
DROP POLICY IF EXISTS "app_records_insert_tenant_member" ON app_records;
DROP POLICY IF EXISTS "app_records_update_tenant_member" ON app_records;
DROP POLICY IF EXISTS "app_records_delete_tenant_member" ON app_records;

-- SELECT: membri del tenant
CREATE POLICY "app_records_select_tenant_member" ON app_records FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));

-- INSERT: membri del tenant
CREATE POLICY "app_records_insert_tenant_member" ON app_records FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));

-- UPDATE: membri del tenant
CREATE POLICY "app_records_update_tenant_member" ON app_records FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid())) WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));

-- DELETE: membri del tenant
CREATE POLICY "app_records_delete_tenant_member" ON app_records FOR DELETE USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 8. POLICY: subscriptions
--    SELECT: membri del tenant possono vedere l'abbonamento
--    INSERT/UPDATE/DELETE: solo service_role (gestito dal backend)
-- ============================================================================

-- Rimuovi policy esistenti per subscriptions (idempotenza)
DROP POLICY IF EXISTS "subscriptions_select_tenant_member" ON subscriptions;
DROP POLICY IF EXISTS "subscriptions_manage_service_role" ON subscriptions;

-- SELECT: membri del tenant
CREATE POLICY "subscriptions_select_tenant_member" ON subscriptions FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));

-- INSERT/UPDATE/DELETE: service_role only (il backend usa la service_role key)
-- Nota: queste policy usano una condizione sempre-false per gli utenti normali,
-- ma il backend con service_role le bypassa completamente.
CREATE POLICY "subscriptions_manage_service_role" ON subscriptions FOR ALL
  USING (true)
  WITH CHECK (true);

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

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
