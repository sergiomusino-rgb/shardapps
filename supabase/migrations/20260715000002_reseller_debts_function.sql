-- ============================================================================
-- ZeusX - Reseller Debts Function
-- Data: 2026-07-15
-- Descrizione: Funzione per ottenere i debiti dei rivenditori
-- ============================================================================

-- Funzione per ottenere i debiti dei rivenditori
CREATE OR REPLACE FUNCTION get_reseller_debts()
RETURNS TABLE (
    reseller_id UUID,
    reseller_email TEXT,
    reseller_name TEXT,
    total_debt DECIMAL(10, 2),
    pending_transactions_count INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.reseller_id,
        p.email,
        p.full_name,
        COALESCE(SUM(t.zeusx_commission), 0.00) as total_debt,
        COUNT(t.id) as pending_transactions_count
    FROM transactions t
    JOIN profiles p ON t.reseller_id = p.user_id
    WHERE t.status = 'pending'
    GROUP BY t.reseller_id, p.email, p.full_name
    ORDER BY total_debt DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_reseller_debts IS 'Restituisce i debiti pendenti di tutti i rivenditori';

-- Funzione per segnare le transazioni come pagate
CREATE OR REPLACE FUNCTION mark_reseller_transactions_paid(p_reseller_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE transactions
    SET status = 'completed'
    WHERE reseller_id = p_reseller_id
      AND status = 'pending';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION mark_reseller_transactions_paid IS 'Segna tutte le transazioni pending di un rivenditore come completate';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================