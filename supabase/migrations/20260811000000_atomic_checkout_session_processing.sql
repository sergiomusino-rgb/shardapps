-- ============================================================================
-- ShardApps - Applicazione atomica di una checkout session (fix consistenza
-- crediti Vision)
-- Data: 2026-08-11
-- ============================================================================
-- PROBLEMA: backend/lib/stripe-webhook-handler.js::applyCheckoutSessionOnce
-- eseguiva 4 scritture SEPARATE (non transazionali):
--   1) INSERT in processed_checkout_sessions (marca la sessione come
--      "processata")
--   2) grant_credits() — accredito crediti Vision
--   3) add_tenant_slots() — somma slot app
--   4) UPDATE tenants.plan (gated da planRank, cumulativo)
-- Se il passo 2 falliva, l'errore veniva solo loggato (mai propagato): la
-- funzione ritornava comunque "successo" con la sessione già marcata come
-- processata al passo 1. Un retry del webhook Stripe per lo stesso evento
-- trovava quindi la sessione già "fatta" e non riprovava mai più
-- l'accredito — cliente pagante senza crediti, nessun modo di recuperare
-- senza intervento manuale.
--
-- SOLUZIONE: un'unica funzione Postgres che esegue marcatura + crediti +
-- slot + piano come UNA transazione. Una funzione plpgsql invocata come
-- singola statement RPC (così la chiama supabase-js/PostgREST) è per
-- costruzione atomica: se una qualunque eccezione non gestita si propaga
-- fuori dalla funzione, Postgres annulla TUTTI gli effetti della chiamata,
-- incluso l'INSERT di marcatura fatto ad inizio funzione — non serve nessun
-- BEGIN/EXCEPTION esplicito, è sufficiente NON intercettare l'eccezione di
-- grant_credits()/add_tenant_slots() e lasciarla risalire.
--
-- Idempotenza + concorrenza: l'INSERT iniziale usa ON CONFLICT (session_id)
-- DO NOTHING invece del vecchio INSERT "nudo" + gestione applicativa
-- dell'errore 23505. Se due esecuzioni concorrenti arrivano per la STESSA
-- session_id, Postgres serializza le due transazioni sul vincolo UNIQUE:
-- la seconda INSERT si blocca finché la prima non termina (commit o
-- rollback). Se la prima ha committato con successo, la seconda vede il
-- conflitto (0 righe da ON CONFLICT DO NOTHING) e ritorna FALSE come no-op.
-- Se la prima è andata in rollback (es. grant_credits fallito), la seconda
-- trova il vincolo libero e riprova l'intera operazione da capo. Nessuna
-- doppia esecuzione, nessuna riga "fantasma", nessun deadlock.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_checkout_session_atomic(
    p_session_id TEXT,
    p_tenant_id UUID,
    p_plan TEXT,
    p_slots_to_add INTEGER,
    p_credits_to_add INTEGER DEFAULT 0,
    p_user_id UUID DEFAULT NULL,
    p_plan_rank_map JSONB DEFAULT '{}'::jsonb
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_inserted TEXT;
    v_current_plan TEXT;
    v_current_rank INTEGER;
    v_new_rank INTEGER;
BEGIN
    -- Guardia di idempotenza/concorrenza: solo chi inserisce con successo la
    -- riga prosegue. Stessa tabella/vincolo già in uso da
    -- 20260723000003_checkout_session_idempotency.sql — comportamento
    -- invariato per chi legge processed_checkout_sessions altrove
    -- (backend/routes/stripe.js::/sync-plan, non toccato da questa
    -- migrazione).
    INSERT INTO processed_checkout_sessions (session_id, tenant_id, plan, slots_added)
    VALUES (p_session_id, p_tenant_id, COALESCE(p_plan, 'credit_topup'), p_slots_to_add)
    ON CONFLICT (session_id) DO NOTHING
    RETURNING session_id INTO v_inserted;

    IF v_inserted IS NULL THEN
        RETURN FALSE; -- sessione già processata (o appena persa la corsa contro un'altra transazione già committata): no-op
    END IF;

    -- Da qui in poi: qualunque eccezione non gestita fa fallire l'intera
    -- funzione/transazione, annullando anche l'INSERT sopra (vedi
    -- descrizione della migrazione). Il chiamante (applyCheckoutSessionOnce)
    -- propaga l'errore fino al webhook Express, che risponde 500: Stripe
    -- ritenterà l'evento più tardi e ritroverà la sessione libera.
    IF p_credits_to_add > 0 THEN
        IF p_user_id IS NULL THEN
            -- Non dovrebbe succedere: create-checkout-session imposta sempre
            -- supabase_user_id nei metadata (vedi commento originale in
            -- stripe-webhook-handler.js). È un problema di dati/metadata
            -- mancanti, non un errore transitorio: un retry di Stripe non lo
            -- risolverebbe mai, quindi non si fa fallire l'intera
            -- applicazione (che bloccherebbe per sempre anche slot/piano) —
            -- si salta solo l'accredito, comportamento invariato rispetto a
            -- prima di questa migrazione.
            RAISE WARNING 'apply_checkout_session_atomic: impossibile accreditare % crediti per la sessione % (tenant %): supabase_user_id mancante', p_credits_to_add, p_session_id, p_tenant_id;
        ELSE
            PERFORM public.grant_credits(
                p_user_id := p_user_id,
                p_amount := p_credits_to_add,
                p_type := 'purchase',
                p_description := 'Acquisto piano ' || COALESCE(p_plan, 'credit_topup'),
                p_reference_id := p_session_id,
                p_metadata := jsonb_build_object('plan_id', COALESCE(p_plan, 'credit_topup'), 'session_id', p_session_id)
            );
        END IF;
    END IF;

    IF p_slots_to_add > 0 THEN
        PERFORM public.add_tenant_slots(p_tenant_id, p_slots_to_add);
    END IF;

    IF p_plan IS NOT NULL THEN
        -- FOR UPDATE: lock la riga tenant per la durata della transazione,
        -- così due sessioni diverse per lo stesso tenant che aggiornano il
        -- piano in parallelo si serializzano invece di poter fare un lost
        -- update sul confronto planRank (stessa logica di
        -- backend/lib/stripe-webhook-logic.js::planRank, passata qui come
        -- p_plan_rank_map per non duplicare la mappa dei piani in due posti
        -- e non introdurre drift tra JS e SQL).
        SELECT plan INTO v_current_plan FROM tenants WHERE id = p_tenant_id FOR UPDATE;
        v_current_rank := COALESCE((p_plan_rank_map ->> v_current_plan)::INTEGER, 0);
        v_new_rank := COALESCE((p_plan_rank_map ->> p_plan)::INTEGER, 0);

        IF v_new_rank >= v_current_rank THEN
            UPDATE tenants SET plan = p_plan, updated_at = now() WHERE id = p_tenant_id;
        END IF;
    END IF;

    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.apply_checkout_session_atomic IS 'Applica una checkout session Stripe (marca processata + accredita crediti Vision + somma slot + aggiorna piano) come unica transazione atomica e idempotente: se un passo fallisce, nessun effetto viene scritto e la sessione resta libera per un retry.';

-- Stesso principio di grant_credits/add_tenant_slots (vedi
-- 20260809000006_revoke_public_credits_and_misc_functions.sql): invocabile
-- solo dal backend (service role, webhook Stripe). Un grant più ampio
-- permetterebbe a un client anon/authenticated di auto-accreditarsi crediti
-- e slot chiamando direttamente questa funzione.
REVOKE EXECUTE ON FUNCTION public.apply_checkout_session_atomic(TEXT, UUID, TEXT, INTEGER, INTEGER, UUID, JSONB) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.apply_checkout_session_atomic(TEXT, UUID, TEXT, INTEGER, INTEGER, UUID, JSONB) TO service_role;

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
