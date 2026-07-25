-- ============================================================================
-- ZeusX - Update tenants to cumulative slot model
-- Data: 2026-07-22
-- Descrizione: Aggiorna i tenant esistenti per il modello cumulativo degli slot
-- Regole:
--   - Nessun piano (free): 0 slot di base
--   - Starter (4,99€): +1 slot
--   - Pro: +5 slot (cumulativo)
--   - Business (250€): +100 slot
-- ============================================================================

-- 1. Prima, assicuriamoci che le colonne esistano
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS app_limit INT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS total_apps_created INTEGER;

-- 2. Imposta app_limit = 0 per tutti i tenant con plan='free' o senza piano
UPDATE tenants 
SET app_limit = 0 
WHERE plan = 'free' OR plan IS NULL OR app_limit IS NULL;

-- 3. Imposta app_limit in base al piano (solo per chi NON ha già slot acquistati)
-- Se un tenant ha già app_limit > 0, significa che ha già acquistato slot
-- e dobbiamo preservare quel valore
UPDATE tenants
SET app_limit = CASE 
  WHEN plan = 'starter' AND (app_limit = 0 OR app_limit IS NULL) THEN 1
  WHEN plan = 'pro' AND (app_limit = 0 OR app_limit IS NULL) THEN 5
  WHEN plan = 'business' AND (app_limit = 0 OR app_limit IS NULL) THEN 100
  ELSE app_limit
END
WHERE plan IN ('starter', 'pro', 'business');

-- 4. Imposta total_apps_created a 0 se NULL
UPDATE tenants 
SET total_apps_created = 0 
WHERE total_apps_created IS NULL;

-- 5. Verifica lo stato
SELECT 
  id,
  name,
  plan,
  app_limit,
  total_apps_created,
  (app_limit - total_apps_created) AS slots_available
FROM tenants
ORDER BY created_at DESC;

-- 6. Commenti
COMMENT ON COLUMN tenants.app_limit IS 'Slot totali disponibili (somma cumulativa di tutti gli slot acquistati)';
COMMENT ON COLUMN tenants.total_apps_created IS 'Contatore permanente di tutte le app create (non decrementa mai)';