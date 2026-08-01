-- ============================================================================
-- ZeusX - Chiude un secondo privilege escalation su tenant_members, trovato
-- dallo script di controllo (check_rls_policies.js) subito dopo aver
-- applicato 20260808000011
-- Data: 2026-08-08
-- ============================================================================
--
-- 20260808000011 ha rimosso la vecchia policy "Tenant members view
-- memberships", ma lo script di controllo ha rivelato che sul database live
-- esistono TRE policy su tenant_members ("tenant_members_insert_self",
-- "tenant_members_update_own", "tenant_members_delete_own") che non
-- compaiono in NESSUN file di migrazione di questo repository — create a
-- mano dalla Dashboard Supabase in un momento non tracciato, quindi mai
-- viste durante l'audit basato sui soli file .sql.
--
-- "tenant_members_update_own" (FOR UPDATE, USING/CHECK: user_id = auth.uid())
-- riproduce IDENTICO il bug appena chiuso: un utente può aggiornare la
-- PROPRIA riga senza alcuna restrizione su quali colonne cambiano, incluso
-- `role` — `UPDATE tenant_members SET role='owner' WHERE user_id=auth.uid()`
-- passa sia USING sia WITH CHECK. Privilege escalation ancora praticabile,
-- solo sotto un nome diverso da quello già corretto.
--
-- "tenant_members_insert_self" (WITH CHECK: user_id = auth.uid()) è
-- potenzialmente anche peggio: permette di inserire una riga con QUALUNQUE
-- tenant_id (non necessariamente il proprio) e QUALUNQUE role, incluso
-- 'owner' — un utente che conosce o indovina l'id di un tenant altrui può
-- auto-inserirsi come suo owner.
--
-- Verificato: NESSUN percorso applicativo (grep su tutto frontend/) fa un
-- insert/update/delete diretto su tenant_members con la anon key — ogni
-- scrittura legittima (creazione agenti, provisioning tenant, ecc.) passa
-- da Server Action con la service role key, che bypassa comunque RLS. Queste
-- tre policy non servono a nessuna funzionalità reale: si possono chiudere
-- del tutto invece di provare a "correggerle" con un WITH CHECK più fine.
-- ============================================================================

DROP POLICY IF EXISTS "tenant_members_insert_self" ON tenant_members;
DROP POLICY IF EXISTS "tenant_members_update_own" ON tenant_members;
DROP POLICY IF EXISTS "tenant_members_delete_own" ON tenant_members;

-- tenant_members_select_own resta invariata: e' l'unica lettura diretta
-- necessaria lato client (es. useComandiRole.ts legge il proprio ruolo).

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
