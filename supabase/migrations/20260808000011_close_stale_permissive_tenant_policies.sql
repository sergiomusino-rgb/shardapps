-- ============================================================================
-- ZeusX - Audit pre-lancio: chiude policy RLS "storiche" mai rimosse che
-- annullano in OR le policy corrette più recenti (privilege escalation)
-- Data: 2026-08-08
-- ============================================================================
--
-- Le policy RLS in Postgres sono PERMISSIVE per default e vengono combinate
-- in OR: se una policy vecchia e permissiva resta attiva, basta lei sola a
-- concedere l'accesso anche se una policy più recente e più restrittiva
-- esiste in parallelo con un nome diverso.
--
-- 1) tenants: la policy originale "Tenant members view tenants" (creata in
--    20250626000000/20250626000001, FOR ALL, USING(sei membro del tenant),
--    NESSUN controllo di ruolo) non è mai stata rimossa. Le migrazioni
--    successive (20260630000001 e seguenti, fino a 20260630000011) hanno
--    provato più volte a sostituirla, ma ogni DROP POLICY IF EXISTS puntava
--    al nome "Tenant members view their tenants" (CON "their") — un refuso
--    di battitura che non corrisponde MAI al nome originale (SENZA "their").
--    Risultato dal vivo: "tenants_update_owner" (20260630000011, corretta,
--    solo owner) convive con la vecchia policy che permette l'UPDATE a
--    QUALUNQUE membro del tenant, incluso un ruolo 'agent' in Comandi —
--    chiunque autenticato come membro di un tenant può aggiornare
--    tenants.plan/app_limit/stripe_subscription_id ecc. con una chiamata
--    REST diretta (anon key + il proprio JWT), bypassando completamente
--    Stripe: un upgrade di piano gratuito auto-concesso.
--
-- 2) tenant_members: stesso identico schema. La policy originale "Tenant
--    members view memberships" (FOR ALL, USING(user_id = auth.uid()), senza
--    WITH CHECK esplicito — quindi USING vale anche per l'UPDATE) non è mai
--    stata rimossa dal nome esatto. Combinata in OR con
--    "tenant_members_manage_owner" (20260630000011, corretta, solo owner
--    può gestire i membri), permette a QUALUNQUE utente di fare UPDATE sulla
--    PROPRIA riga tenant_members senza restrizioni sui campi — incluso il
--    campo `role`: un membro con ruolo 'agent' può eseguire
--    `update tenant_members set role='owner' where user_id=auth.uid()`
--    e auto-promuoversi a owner del proprio tenant. Privilege escalation
--    completa, la falla più grave di questo audit.
--
-- 3) apps / subscriptions: stesso pattern, redazione per igiene — le policy
--    granulari più recenti (apps_*_tenant_member, subscriptions_select_
--    tenant_member) hanno già lo stesso perimetro della vecchia policy (nessun
--    controllo di ruolo aggiuntivo in nessuna delle due versioni), quindi qui
--    non si chiude un privilegio in più: si rimuove solo la ridondanza per
--    evitare che lo stesso refuso passi inosservato in futuro.
--
-- IMPORTANTE: questa migrazione va applicata IMMEDIATAMENTE sul database di
-- produzione (Supabase Dashboard → SQL Editor, o `supabase db push`), non
-- basta che il file esista nel repository — le policy restano attive finché
-- non viene eseguita.
-- ============================================================================

DROP POLICY IF EXISTS "Tenant members view tenants" ON tenants;
DROP POLICY IF EXISTS "Tenant members view memberships" ON tenant_members;
DROP POLICY IF EXISTS "Users access only their tenant apps" ON apps;
DROP POLICY IF EXISTS "Tenant owners view subscriptions" ON subscriptions;

-- ============================================================================
-- Verifica: dopo questa migrazione, per ciascuna tabella deve restare
-- esattamente il set di policy granulari create in
-- 20260630000011_rls_policies_auth_uid.sql (tenants_select_member,
-- tenants_insert_authenticated, tenants_update_owner, tenants_delete_owner;
-- tenant_members_select_own, tenant_members_manage_owner;
-- apps_select/insert/update/delete_tenant_member;
-- subscriptions_select_tenant_member, subscriptions_manage_service_role).
-- ============================================================================

-- ============================================================================
-- 2. Isolamento per RUOLO all'interno dello stesso tenant (Comandi)
-- ============================================================================
-- Le policy di 20260730000000_comandi_schema.sql e 20260803000000_
-- comandi_agent_role.sql sono FOR ALL senza distinzione di ruolo: qualunque
-- tenant_member (incluso 'agent') può scrivere su catalog_items/
-- product_synonyms/orders/order_items via REST diretta, anche se l'app
-- mostra queste sezioni come sola lettura o le nasconde del tutto per
-- l'agente (Catalogo in sola lettura, Magazzino nascosto, Storico Ordini
-- accessibile solo a owner/admin/member) — l'unica barriera reale finora era
-- lato client, aggirabile. customers resta FOR ALL per ogni ruolo: è una
-- scelta di prodotto esplicita (l'agente gestisce la propria rubrica clienti
-- sul campo), non un refuso.

-- catalog_items / product_synonyms: lettura per tutti i membri del tenant,
-- scrittura riservata a owner/admin/member (l'agente vede il catalogo ma non
-- lo modifica, coerente con ComandiInstanceDashboard.tsx: readOnly={isAgent}).
DROP POLICY IF EXISTS "Tenant members access own catalog_items" ON catalog_items;
CREATE POLICY "catalog_items_select_tenant_member" ON catalog_items FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "catalog_items_write_non_agent" ON catalog_items FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role <> 'agent'));
CREATE POLICY "catalog_items_update_non_agent" ON catalog_items FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role <> 'agent'))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role <> 'agent'));
CREATE POLICY "catalog_items_delete_non_agent" ON catalog_items FOR DELETE
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role <> 'agent'));

DROP POLICY IF EXISTS "Tenant members access own product_synonyms" ON product_synonyms;
CREATE POLICY "product_synonyms_select_tenant_member" ON product_synonyms FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "product_synonyms_write_non_agent" ON product_synonyms FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role <> 'agent'));
CREATE POLICY "product_synonyms_update_non_agent" ON product_synonyms FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role <> 'agent'))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role <> 'agent'));
CREATE POLICY "product_synonyms_delete_non_agent" ON product_synonyms FOR DELETE
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role <> 'agent'));

-- orders / order_items: l'agente raccoglie ordini (INSERT) e vede lo storico
-- (SELECT, filtrato lato client sui propri in MyOrdersTab), ma non deve poter
-- modificare/cancellare un ordine già registrato (conferma/annullamento sono
-- già bloccate lato server per il ruolo agente in updateOrderStatusAction —
-- questa policy chiude lo stesso identico bypass via REST diretta).
DROP POLICY IF EXISTS "Tenant members access own orders" ON orders;
CREATE POLICY "orders_select_tenant_member" ON orders FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "orders_insert_tenant_member" ON orders FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "orders_update_non_agent" ON orders FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role <> 'agent'))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role <> 'agent'));
CREATE POLICY "orders_delete_non_agent" ON orders FOR DELETE
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role <> 'agent'));

DROP POLICY IF EXISTS "Tenant members access own order_items" ON order_items;
CREATE POLICY "order_items_select_tenant_member" ON order_items FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "order_items_insert_tenant_member" ON order_items FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));
CREATE POLICY "order_items_update_non_agent" ON order_items FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role <> 'agent'))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role <> 'agent'));
CREATE POLICY "order_items_delete_non_agent" ON order_items FOR DELETE
  USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid() AND role <> 'agent'));

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
