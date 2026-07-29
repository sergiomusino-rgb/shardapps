-- ============================================================================
-- ZeusX - Vision Studio: crediti, storico transazioni, RPC atomiche, storage
-- Data: 2026-07-26
-- Descrizione: schema per il modulo Vision (generazione video image-to-video
-- via Fal.ai). Il consumo crediti passa esclusivamente da funzioni RPC
-- atomiche (deduct_credits/refund_credits) per evitare race condition tra
-- richieste concorrenti dello stesso utente e per garantire che ogni
-- movimento sia sempre accompagnato da una riga in credit_transactions.
-- ============================================================================

-- 1. COLONNA: profiles.credits
-- Nota: 10 crediti di benvenuto ai nuovi profili (bonus onboarding). Regolare
-- o rimuovere il default se la policy commerciale prevede 0 crediti iniziali.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS credits INTEGER NOT NULL DEFAULT 10;
COMMENT ON COLUMN profiles.credits IS 'Saldo crediti Vision disponibili per l''utente';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'profiles_credits_non_negative'
    ) THEN
        ALTER TABLE profiles ADD CONSTRAINT profiles_credits_non_negative CHECK (credits >= 0) NOT VALID;
    END IF;
END $$;

-- 2. TABELLA: credit_transactions
-- Storico immutabile di ogni movimento crediti (addebiti, rimborsi, ricariche).
CREATE TABLE IF NOT EXISTS credit_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL, -- negativo = addebito, positivo = accredito/rimborso
    type TEXT NOT NULL CHECK (type IN ('generation', 'refund', 'purchase', 'bonus', 'adjustment')),
    reference_id TEXT, -- es. request id Fal.ai
    description TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE credit_transactions IS 'Storico movimenti crediti Vision (addebiti/rimborsi/ricariche)';
COMMENT ON COLUMN credit_transactions.amount IS 'Delta crediti: negativo per addebiti, positivo per accrediti/rimborsi';
COMMENT ON COLUMN credit_transactions.reference_id IS 'ID esterno correlato (es. request id Fal.ai)';

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at ON credit_transactions(created_at DESC);

ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "credit_transactions_select_own" ON credit_transactions;
CREATE POLICY "credit_transactions_select_own" ON credit_transactions
    FOR SELECT USING (user_id = auth.uid());

-- Solo il service role (usato dalle API route server-side) può scrivere
-- direttamente sulla tabella; i client autenticati passano sempre dalle RPC
-- sottostanti, che sono SECURITY DEFINER e non richiedono policy INSERT qui.
DROP POLICY IF EXISTS "credit_transactions_service_role_all" ON credit_transactions;
CREATE POLICY "credit_transactions_service_role_all" ON credit_transactions
    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- 3. RPC: deduct_credits
-- Addebita atomicamente p_amount crediti se e solo se il saldo è sufficiente
-- (guardia nella WHERE della UPDATE: nessuna finestra di race condition tra
-- lettura e scrittura, anche con richieste concorrenti sullo stesso utente).
-- Ritorna NULL (nessuna riga) se il saldo non basta: il chiamante deve
-- trattare un risultato vuoto come "crediti insufficienti".
CREATE OR REPLACE FUNCTION public.deduct_credits(
    p_user_id UUID,
    p_amount INTEGER,
    p_type TEXT,
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

    UPDATE profiles
    SET credits = credits - p_amount
    WHERE user_id = p_user_id AND credits >= p_amount
    RETURNING credits INTO v_new_balance;

    IF NOT FOUND THEN
        RETURN; -- saldo insufficiente: nessuna riga, nessun addebito
    END IF;

    INSERT INTO credit_transactions (user_id, amount, type, description, reference_id, metadata)
    VALUES (p_user_id, -p_amount, p_type, p_description, p_reference_id, p_metadata)
    RETURNING id INTO v_transaction_id;

    RETURN QUERY SELECT v_new_balance, v_transaction_id;
END;
$$;

COMMENT ON FUNCTION public.deduct_credits IS 'Addebita crediti in modo atomico; nessuna riga = saldo insufficiente';

-- 4. RPC: refund_credits
-- Paracadute finanziario: riaccredita p_amount crediti (es. quando Fal.ai
-- fallisce dopo che i crediti sono già stati scalati) e registra il rimborso.
CREATE OR REPLACE FUNCTION public.refund_credits(
    p_user_id UUID,
    p_amount INTEGER,
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

    UPDATE profiles
    SET credits = credits + p_amount
    WHERE user_id = p_user_id
    RETURNING credits INTO v_new_balance;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Profilo non trovato per utente %', p_user_id;
    END IF;

    INSERT INTO credit_transactions (user_id, amount, type, description, reference_id, metadata)
    VALUES (p_user_id, p_amount, 'refund', p_description, p_reference_id, p_metadata)
    RETURNING id INTO v_transaction_id;

    RETURN QUERY SELECT v_new_balance, v_transaction_id;
END;
$$;

COMMENT ON FUNCTION public.refund_credits IS 'Rimborsa crediti in modo atomico e registra la transazione di rimborso';

-- Le RPC sono SECURITY DEFINER e devono essere invocabili solo dal backend
-- (service role), mai direttamente da un client con la sola anon/authenticated
-- key: altrimenti un utente potrebbe auto-accreditarsi crediti a piacere
-- chiamando refund_credits senza che sia mai avvenuto un addebito reale.
REVOKE EXECUTE ON FUNCTION public.deduct_credits(UUID, INTEGER, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refund_credits(UUID, INTEGER, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deduct_credits(UUID, INTEGER, TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_credits(UUID, INTEGER, TEXT, TEXT, JSONB) TO service_role;

-- 5. STORAGE: bucket 'vision-uploads'
-- Immagini sorgente caricate dall'utente come primo frame per la generazione
-- video. Bucket pubblico in lettura (l'URL viene passato a Fal.ai, che deve
-- poterla scaricare senza autenticazione); scrittura riservata a utenti
-- autenticati e solo dentro la propria cartella "{user_id}/...".
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('vision-uploads', 'vision-uploads', true, 20971520, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "vision_uploads_public_read" ON storage.objects;
CREATE POLICY "vision_uploads_public_read" ON storage.objects
    FOR SELECT USING (bucket_id = 'vision-uploads');

DROP POLICY IF EXISTS "vision_uploads_own_folder_insert" ON storage.objects;
CREATE POLICY "vision_uploads_own_folder_insert" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'vision-uploads'
        AND auth.role() = 'authenticated'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS "vision_uploads_own_folder_delete" ON storage.objects;
CREATE POLICY "vision_uploads_own_folder_delete" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'vision-uploads'
        AND auth.role() = 'authenticated'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- 6. REALTIME: pubblica profiles per l'indicatore crediti in tempo reale
-- (guardia idempotente: ALTER PUBLICATION ... ADD TABLE fallisce se la
-- tabella è già membro della pubblicazione).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'profiles'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE profiles;
    END IF;
END $$;

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
