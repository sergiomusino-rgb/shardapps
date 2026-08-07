-- ============================================================================
-- ShardApps - White label reseller: "Brandizza la tua app"
-- Data: 2026-08-09
-- Descrizione: aggiunge a tenants il logo/testo del reseller (piano Business)
-- che sostituisce "ShardApps by MUSINO" nel footer sidebar di ogni app
-- generata (app/a/[slug]/app/sidebar-primitives.tsx, SidebarBrandFooter).
-- Impostato una volta in /dashboard/creator (vedi CreatorBrandingPanel) e
-- applicato automaticamente ad ogni pubblicazione (api/creator/publish,
-- api/creator/create) in apps.config.branding.footer_logo_url/footer_label —
-- non tocca apps direttamente, stesso pattern colonne-dirette già in uso su
-- tenants (vedi 20260808000010_tenants_logo_url.sql, di scopo diverso: quello
-- è il logo del business del tenant stesso, questo è il logo del reseller
-- mostrato nelle app dei SUOI clienti).
-- ============================================================================

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS white_label_logo_url TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS white_label_label TEXT;

COMMENT ON COLUMN tenants.white_label_logo_url IS 'URL pubblico (bucket vision-uploads) del logo reseller white label, piano Business — sostituisce il logo ShardApps nel footer sidebar delle app generate da questo tenant';
COMMENT ON COLUMN tenants.white_label_label IS 'Testo opzionale sotto il logo white label (es. "by Rossi Digital"), stesso campo footer_label di apps.config.branding';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
