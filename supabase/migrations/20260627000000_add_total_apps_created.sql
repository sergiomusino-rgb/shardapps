-- Migration: aggiungi campo total_apps_created alla tabella tenants
-- Questo campo conta tutte le app create permanentemente (anche quelle cancellate)
-- Il campo non si libera mai

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS total_apps_created INTEGER NOT NULL DEFAULT 0;
