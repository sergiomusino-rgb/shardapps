-- ============================================================================
-- ZeusX - Tabella token per il reset password self-service (legacy auth)
-- Data: 2026-08-09
-- ============================================================================
-- FASE 4B / Fix #2 (report FASE 4A): l'endpoint reset-password/[slug] resetta
-- la password sapendo solo slug+client_email, senza provare il possesso della
-- casella, e restituisce la nuova password in chiaro nella risposta HTTP:
-- chiunque conosca slug+email prende il controllo dell'app (account
-- takeover). Il fix richiede un token monouso con scadenza breve, inviato
-- via email, mai esposto nella risposta HTTP dell'endpoint pubblico.
--
-- Nessuna struttura riutilizzabile esisteva in precedenza (verificato:
-- apps.expires_at è la scadenza dell'app/abbonamento, non un token di reset;
-- questo auth_mode 'legacy' non usa Supabase Auth quindi non ha a
-- disposizione resetPasswordForEmail nativo).
--
-- Si salva solo l'hash SHA-256 del token, mai il valore in chiaro (stesso
-- principio delle password: se il DB trapela, i token già emessi restano
-- inutilizzabili). Stesso pattern deny-all già in uso per app_credentials
-- (20260808000004): nessun accesso per anon/authenticated, solo service_role
-- (bypassa RLS) può leggere/scrivere, dato che l'endpoint pubblico usa quella
-- chiave lato server.
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_password_reset_tokens (
  token_hash text PRIMARY KEY,
  app_id uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_password_reset_tokens_app_id_idx
  ON app_password_reset_tokens (app_id);

ALTER TABLE app_password_reset_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_password_reset_tokens_deny_anon_authenticated" ON app_password_reset_tokens FOR ALL
  USING (false)
  WITH CHECK (false);

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
