-- ============================================================================
-- ZeusX - Chiude un privilege escalation A LIVELLO PIATTAFORMA su profiles.role
-- Trovato dallo script di controllo dopo aver chiuso i due bug su
-- tenants/tenant_members
-- Data: 2026-08-08
-- ============================================================================
--
-- profiles.role è il controllo di autorizzazione per le rotte admin della
-- piattaforma (vedi app/api/admin/takeover/route.ts:42,
-- "return profile?.role === 'admin'", stesso pattern in reseller-debts e
-- mark-paid) — NON è scoped a un singolo tenant come tenant_members.role:
-- un utente con profiles.role='admin' ha accesso ad azioni come il takeover
-- (impersonare/prendere il controllo dell'account) di QUALUNQUE reseller
-- sulla piattaforma.
--
-- Sul database live esistono, oltre a profiles_select/profiles_select_own
-- (sola lettura, corrette), le seguenti policy — nessuna delle quali
-- compare in un file di migrazione di questo repository (stesso drift da
-- Dashboard mai tracciato già visto su tenant_members):
--   - "Users view own profile" (FOR ALL, USING: user_id=auth.uid() OR sei
--     nello stesso tenant del proprietario del profilo — senza WITH CHECK
--     esplicito, quindi vale anche per INSERT/UPDATE)
--   - profiles_insert / profiles_insert_own (WITH CHECK: user_id=auth.uid())
--   - profiles_update / profiles_update_own (USING: user_id=auth.uid(),
--     nessun WITH CHECK esplicito)
--   - profiles_delete (USING: user_id=auth.uid() OR has_table_access(...))
-- Nessuna di queste restringe QUALI colonne possono cambiare: un utente può
-- eseguire `UPDATE profiles SET role='admin' WHERE user_id=auth.uid()` e
-- ottenere accesso admin sull'intera piattaforma.
--
-- Verificato: nessun percorso applicativo (grep su tutto frontend/) fa un
-- insert/update/delete diretto su profiles con la anon key — ogni scrittura
-- legittima passa da codice server-side con la service role key, che
-- bypassa comunque RLS. Chiuse del tutto invece di provare a restringerle
-- per colonna (più fragile: basterebbe dimenticare una colonna sensibile
-- futura per riaprire lo stesso buco).
-- ============================================================================

DROP POLICY IF EXISTS "Users view own profile" ON profiles;
DROP POLICY IF EXISTS "profiles_insert" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
DROP POLICY IF EXISTS "profiles_update" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
DROP POLICY IF EXISTS "profiles_delete" ON profiles;

-- profiles_select / profiles_select_own restano invariate: sola lettura
-- (propria riga, o has_table_access per il pannello admin) — nessuna
-- capacità di scrittura diretta da client rimane per anon/authenticated.

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
