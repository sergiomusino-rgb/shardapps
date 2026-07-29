-- ============================================================================
-- ZeusX - Vision: RPC grant_credits per accrediti da acquisto reale
-- Data: 2026-07-27
-- Descrizione: i piani Starter/Pro/Business includono ora crediti Vision, e
-- la "Ricarica Extra" (ex Slot Extra) accredita crediti invece di slot app.
-- grant_credits è la controparte "in entrata" di deduct_credits/refund_credits
-- (vedi 20260726000000_vision_credits_schema.sql): tenuta separata da
-- refund_credits per non toccare il percorso già in produzione del
-- paracadute finanziario di /api/generate-video, e per registrare il "type"
-- corretto in credit_transactions (purchase/bonus/adjustment vs refund).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.grant_credits(
    p_user_id UUID,
    p_amount INTEGER,
    p_type TEXT DEFAULT 'purchase',
    p_description TEXT DEFAULT NULL,
    p_reference_id TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (new_balance INTEGER, transaction_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_new_balance INTEGER;
    v_transaction_id UUID;
BEGIN
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'p_amount deve essere positivo';
    END IF;
    IF p_type NOT IN ('purchase', 'bonus', 'adjustment') THEN
        RAISE EXCEPTION 'p_type non valido per grant_credits: %', p_type;
    END IF;

    UPDATE profiles
    SET credits = credits + p_amount
    WHERE user_id = p_user_id
    RETURNING credits INTO v_new_balance;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Profilo non trovato per utente %', p_user_id;
    END IF;

    INSERT INTO credit_transactions (user_id, amount, type, description, reference_id, metadata)
    VALUES (p_user_id, p_amount, p_type, p_description, p_reference_id, p_metadata)
    RETURNING id INTO v_transaction_id;

    RETURN QUERY SELECT v_new_balance, v_transaction_id;
END;
$$;

COMMENT ON FUNCTION public.grant_credits IS 'Accredita crediti da un acquisto reale (piano o ricarica) in modo atomico';

-- Invocabile solo dal backend (service role, es. webhook Stripe): mai da un
-- client con la sola anon/authenticated key, altrimenti un utente potrebbe
-- auto-accreditarsi crediti senza aver pagato nulla.
REVOKE EXECUTE ON FUNCTION public.grant_credits(UUID, INTEGER, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_credits(UUID, INTEGER, TEXT, TEXT, TEXT, JSONB) TO service_role;

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
