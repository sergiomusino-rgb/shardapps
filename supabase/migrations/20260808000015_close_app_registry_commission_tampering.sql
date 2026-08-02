-- ============================================================================
-- ZeusX - Chiude un privilege escalation FINANZIARIO su app_registry
-- Trovato dallo script di controllo, stessa scansione dei bug su
-- tenants/tenant_members/profiles
-- Data: 2026-08-08
-- ============================================================================
--
-- app_registry.monthly_fee e app_registry.zeusx_share sono la quota mensile
-- pagata dal rivenditore e la percentuale trattenuta da ZeusX su quella
-- quota (vedi commenti su 20260714000000_create_app_registry_table.sql) —
-- cioè il modello di fatturazione/commissione della piattaforma stessa.
--
-- La policy "Resellers manage their own apps" (FOR ALL, USING/CHECK:
-- reseller_id = auth.uid() AND ownership_status = 'reseller_owned') non
-- restringe QUALI colonne un rivenditore può modificare sulla propria riga:
-- un rivenditore autenticato può eseguire
--   UPDATE app_registry SET monthly_fee = 0, zeusx_share = 0
--   WHERE reseller_id = auth.uid()
-- azzerando quanto deve a ZeusX, con una chiamata REST diretta (anon key +
-- il proprio JWT).
--
-- Verificato: nessun percorso applicativo (grep su tutto frontend/) fa un
-- insert/update/delete diretto su app_registry con la anon key — l'unico
-- insert (comandi-provisioning.ts) usa la service role key. Rimossa la
-- capacità di scrittura diretta dal rivenditore: resta solo la lettura
-- della propria riga (già coperta da "Resellers view their own apps").
-- ============================================================================

DROP POLICY IF EXISTS "Resellers manage their own apps" ON app_registry;

-- "Resellers view their own apps" (SELECT) e "Service role manages
-- app_registry" (USING(false) per anon/authenticated, già corretta in
-- 20260808000001) restano invariate.

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
