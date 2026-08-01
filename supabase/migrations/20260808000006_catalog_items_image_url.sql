-- ============================================================================
-- ZeusX - Motore "Comandi": immagine prodotto per l'import massivo catalogo
-- Data: 2026-08-08
-- Descrizione: aggiunge una colonna image_url a catalog_items, per accogliere
-- il link immagine mappato dall'import Excel/CSV (app/api/catalog/import,
-- vedi mapping di sinonimi image_url/immagine/foto), analoga a category
-- aggiunta in 20260804000000_catalog_items_category.sql. Nessun vincolo di
-- formato: il valore è testo libero fornito dal tenant, non validato come URL.
-- ============================================================================

ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS image_url TEXT;

COMMENT ON COLUMN catalog_items.image_url IS 'URL immagine del prodotto, opzionale — popolato dall''import massivo del catalogo';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
