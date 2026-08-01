-- ============================================================================
-- ZeusX - Motore "Comandi": campi extra dall'import massivo catalogo
-- Data: 2026-08-08
-- Descrizione: aggiunge una colonna extra_fields (JSONB) a catalog_items per
-- conservare le colonne del file importato (app/api/catalog/import) che non
-- corrispondono a nessun campo nativo del catalogo (es. Brand, Formato/
-- Confezione, Aliquota IVA di un listino ingrosso reale) — dato reale che
-- l'utente si aspetta di ritrovare, invece di essere scartato in silenzio.
-- JSONB invece di colonne dedicate: le colonne extra variano da file a file
-- e da tenant a tenant, un'ALTER TABLE per ognuna non è sostenibile.
-- ============================================================================

ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS extra_fields JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN catalog_items.extra_fields IS 'Coppie nome/valore delle colonne del file importato senza un campo nativo corrispondente (es. Brand, Formato) — testo libero, popolato dall''import massivo del catalogo';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
