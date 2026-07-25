-- ============================================================================
-- ZeusX - Fix RLS policy for apps table to allow reading by totalum_app_id
-- Data: 2026-07-20
-- Descrizione: Risolve il problema di lettura app tramite totalum_app_id
-- ============================================================================

-- Abilita RLS se non già abilitata
ALTER TABLE IF EXISTS apps ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 1. Policy: Lettura pubblica per totalum_app_id (per API checkout)
-- Permette a chiunque (anche senza auth) di leggere un'app specificando totalum_app_id
-- Questo è necessario perché le API di checkout usano SUPABASE_SERVICE_ROLE_KEY
-- ma potrebbero essere chiamate da client senza autenticazione
-- ============================================================================
DROP POLICY IF EXISTS "apps_select_by_totalum_app_id" ON apps;
CREATE POLICY "apps_select_by_totalum_app_id" ON apps 
    FOR SELECT 
    USING (
        client_active = true
    );

-- ============================================================================
-- 2. Policy: Service role access (amministrazione)
-- Permette al service_role di accedere a TUTTE le app senza restrizioni
-- Questo è fondamentale perché le API usano SUPABASE_SERVICE_ROLE_KEY
-- che deve poter leggere qualsiasi app per totalum_app_id
-- ============================================================================
DROP POLICY IF EXISTS "apps_service_role_all" ON apps;
CREATE POLICY "apps_service_role_all" ON apps 
    FOR ALL 
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- 3. Verifica che l'indice esista per totalum_app_id
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_apps_totalum_app_id ON apps(totalum_app_id);

-- ============================================================================
-- 4. Query di debug: Verifica app con totalum_app_id
-- Esegui questa query per controllare se l'app 'pizzeria' esiste
-- ============================================================================
-- SELECT id, name, slug, totalum_app_id, client_active, created_at 
-- FROM apps 
-- WHERE totalum_app_id = 'pizzeria' OR slug = 'pizzeria';

-- ============================================================================
-- FINE MIGRAZIONE
