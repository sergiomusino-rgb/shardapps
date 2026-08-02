-- ============================================================================
-- ZeusX - Comandi: aggiunge lo stato READY (Pronto) al flusso ordini
-- Descrizione: il flusso ordini del titolare era Approvato -> In preparazione
-- -> Evaso, senza uno stadio intermedio per segnalare che l'ordine è pronto
-- per il ritiro/consegna prima di essere evaso. Aggiunge READY all'enum
-- order_status, tra PROCESSING e COMPLETED.
-- ============================================================================

ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'READY' AFTER 'PROCESSING';
