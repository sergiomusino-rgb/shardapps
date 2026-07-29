-- ============================================================================
-- ZeusX - Motore "Comandi": categoria prodotto per l'import massivo catalogo
-- Data: 2026-08-04
-- Descrizione: aggiunge una colonna categoria libera a catalog_items, usata
-- dal template di import Excel/CSV (app/api/catalog/import). Nessun vincolo
-- di enum: le categorie sono testo libero definito dal tenant, non una
-- tassonomia centrale.
-- ============================================================================

ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS category TEXT;

COMMENT ON COLUMN catalog_items.category IS 'Categoria libera del prodotto (es. Bevande, Panetteria), opzionale — usata dall''import massivo del catalogo';

CREATE INDEX IF NOT EXISTS idx_catalog_items_category ON catalog_items(tenant_id, category);

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
