-- ============================================================================
-- ZeusX - Rate limiting applicativo per endpoint non coperti da Vercel Firewall
-- Data: 2026-08-08
-- Descrizione: il piano Vercel corrente permette una sola regola di rate
-- limiting lato Firewall (già usata per /api/creator/generate, l'endpoint più
-- costoso). /api/chat e /api/apps/[id]/subscribe-push vengono limitati qui,
-- con un contatore a finestra fissa in Postgres controllato atomicamente da
-- una funzione SECURITY DEFINER (nessuna race condition tra richieste
-- concorrenti sulla stessa key, a differenza di un semplice select+insert).
-- ============================================================================

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  key text NOT NULL,
  window_start bigint NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

ALTER TABLE rate_limit_counters ENABLE ROW LEVEL SECURITY;

-- Nessun accesso diretto per anon/authenticated: solo la funzione
-- SECURITY DEFINER sotto (chiamata dalle API route con la service_role key)
-- deve poter leggere/scrivere questa tabella.
DROP POLICY IF EXISTS "rate_limit_counters_deny_anon_authenticated" ON rate_limit_counters;
CREATE POLICY "rate_limit_counters_deny_anon_authenticated" ON rate_limit_counters FOR ALL
  USING (false)
  WITH CHECK (false);

-- check_rate_limit: incrementa atomicamente il contatore del bucket corrente
-- per `p_key` (finestra fissa di p_window_seconds) e restituisce se la
-- richiesta è ammessa. Pulisce opportunisticamente i bucket scaduti della
-- stessa key ad ogni chiamata, invece di richiedere un cron dedicato.
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key text,
  p_window_seconds integer,
  p_max_requests integer
)
RETURNS TABLE(allowed boolean, remaining integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bucket bigint;
  v_count integer;
BEGIN
  v_bucket := floor(extract(epoch FROM now()) / p_window_seconds)::bigint;

  INSERT INTO rate_limit_counters (key, window_start, count)
  VALUES (p_key, v_bucket, 1)
  ON CONFLICT (key, window_start)
  DO UPDATE SET count = rate_limit_counters.count + 1
  RETURNING rate_limit_counters.count INTO v_count;

  DELETE FROM rate_limit_counters
  WHERE key = p_key AND window_start < v_bucket - 1;

  RETURN QUERY SELECT v_count <= p_max_requests, GREATEST(p_max_requests - v_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION check_rate_limit(text, integer, integer) TO service_role;

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
