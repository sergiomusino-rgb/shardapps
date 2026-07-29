-- ============================================================================
-- ZeusX - Chiude 3 policy RLS "service role" permissive per qualunque ruolo
-- Data: 2026-08-08
-- Descrizione: audit pre-lancio ha trovato lo stesso refuso già corretto per
-- `subscriptions` in 20260723000002_lockdown_apps_credentials_and_subscriptions.sql
-- (USING(true)/WITH CHECK(true) senza clausola TO, quindi valido per
-- anon/authenticated oltre che per service_role) ripetuto su altre 3 tabelle,
-- mai sanato:
--
-- - app_registry: commissioni/dati dei rivenditori (reseller_id, monthly_fee,
--   zeusx_share) — la policy "Resellers manage their own apps" (reseller_id =
--   auth.uid()) esiste già ma è resa inutile dall'OR con questa permissiva.
-- - transactions: transazioni di pagamento e commissioni ZEUSX.
-- - processed_checkout_sessions: guardia di idempotenza sugli acquisti
--   Stripe/slot (20260723000003) — qui non esiste NESSUN'ALTRA policy, quindi
--   il bypass è totale: chiunque autenticato può leggere/inserire/cancellare
--   righe con la sola anon/authenticated key via REST diretta.
--
-- Fix: stesso pattern già adottato per subscriptions — USING(false)/WITH
-- CHECK(false) blocca anon/authenticated, il service_role bypassa comunque
-- RLS (non è soggetto a nessuna policy), quindi l'accesso da backend/route
-- Next.js con la service_role key resta invariato.
-- ============================================================================

DROP POLICY IF EXISTS "Service role manages app_registry" ON app_registry;
CREATE POLICY "Service role manages app_registry" ON app_registry FOR ALL
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "Service role manages transactions" ON transactions;
CREATE POLICY "Service role manages transactions" ON transactions FOR ALL
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "Service role manages processed_checkout_sessions" ON processed_checkout_sessions;
CREATE POLICY "Service role manages processed_checkout_sessions" ON processed_checkout_sessions FOR ALL
  USING (false)
  WITH CHECK (false);

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
