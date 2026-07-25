-- ============================================================================
-- ZeusX - Idempotenza acquisto piani/slot
-- Data: 2026-07-23
-- Descrizione: Il piano viene sincronizzato da 3 punti diversi (webhook Stripe,
-- pagina /success, banner dashboard) che possono tutti processare la stessa
-- checkout session. Con il modello cumulativo degli slot (vedi
-- 20260721_ensure_slots_columns.sql / 20260722_update_tenants_slots_cumulative.sql)
-- processarla più volte sommerebbe gli slot più volte. Questa tabella registra
-- quali session_id sono già stati applicati: solo il primo che riesce a
-- inserire la riga (vincolo di unicità) somma gli slot, gli altri diventano no-op.
-- ============================================================================

CREATE TABLE IF NOT EXISTS processed_checkout_sessions (
  session_id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  slots_added INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE processed_checkout_sessions IS 'Guardia di idempotenza: una checkout session Stripe somma slot al tenant una sola volta, indipendentemente da quale dei 3 endpoint la processa per primo';

ALTER TABLE processed_checkout_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages processed_checkout_sessions" ON processed_checkout_sessions
  FOR ALL
  USING (true)
  WITH CHECK (true);
