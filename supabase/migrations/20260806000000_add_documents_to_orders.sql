-- ============================================================================
-- ZeusX - Motore "Comandi": riferimenti documentali sull'ordine
-- Data: 2026-08-06
-- Descrizione: aggiunge il numero di bolla di accompagnamento e il numero di
-- fattura all'ordine, per completare la tabella "Ordini" richiesta (scheda
-- riassuntiva per cliente con tutti i riferimenti economici e documentali).
-- Testo libero e nullable: la numerazione di bolle/fatture resta un processo
-- esterno (gestionale contabile del cliente), qui si registra solo il
-- riferimento per ritrovarlo in fase di esportazione.
-- ============================================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_note_number TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_number TEXT;

COMMENT ON COLUMN orders.delivery_note_number IS 'Numero della bolla di accompagnamento associata all''ordine, se emessa';
COMMENT ON COLUMN orders.invoice_number IS 'Numero della fattura associata all''ordine, se emessa';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
