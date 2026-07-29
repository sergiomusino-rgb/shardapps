-- ============================================================================
-- ZeusX - Lockdown colonne sensibili su profiles
-- Data: 2026-08-02
-- Descrizione: la policy RLS "profiles_update_own" (FOR UPDATE USING
-- (user_id = auth.uid())) autorizza l'update dell'INTERA riga, senza
-- restrizioni per colonna: un utente autenticato con la sola anon/
-- authenticated key potrebbe quindi eseguire direttamente dal browser
--   supabase.from('profiles').update({ credits: 999999 }).eq('user_id', ...)
-- bypassando completamente le RPC deduct_credits/grant_credits/refund_credits
-- (che sono SECURITY DEFINER ma non impediscono un update diretto della
-- tabella, che passa "solo" dalla RLS). Stesso discorso per role,
-- subscription_plan, subscription_status, stripe_connect_id: un utente
-- potrebbe auto-promuoversi ad 'admin' o a un piano superiore.
--
-- Verificato (grep su frontend/ e backend/) che nessun codice applicativo
-- scrive oggi su queste colonne lato client: il fix è quindi additivo e non
-- rompe alcun flusso esistente. Le RPC/i webhook, che usano tutti la service
-- role key (bypassa sempre RLS e i GRANT di riga), continuano a funzionare
-- invariati.
--
-- Il fix agisce a livello di GRANT di colonna (ortogonale alla RLS): anche
-- quando la RLS autorizza la riga, senza GRANT UPDATE sulla colonna
-- specifica l'update viene comunque rifiutato da Postgres.
-- ============================================================================

REVOKE UPDATE ON profiles FROM authenticated;

-- Uniche colonne che un utente può legittimamente autoaggiornare: dati di
-- contatto/anagrafica, mai crediti, ruolo, piano o collegamenti Stripe.
GRANT UPDATE (email, full_name) ON profiles TO authenticated;

COMMENT ON TABLE profiles IS 'Profili utente. UPDATE diretto (authenticated) limitato a email/full_name via GRANT di colonna: credits/role/subscription_plan/subscription_status/stripe_connect_id/company_id sono scrivibili solo da service_role (RPC o backend).';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
