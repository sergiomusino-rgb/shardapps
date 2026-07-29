-- ============================================================================
-- ZeusX - Ensure slots columns exist for all tenants (CUMULATIVE MODEL)
-- Data: 2026-07-21
-- Descrizione: Assicura che app_limit e total_apps_created esistano con valori corretti
-- Regole:
--   - Nessun piano (free): 0 slot di base
--   - Starter (4,99€): +1 slot
--   - Pro: +5 slot (cumulativo)
--   - Business (250€): +100 slot
--   - Slot extra: +1 slot
-- ============================================================================

-- 1. Aggiungi colonne se non esistono
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS app_limit INT NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS total_apps_created INTEGER NOT NULL DEFAULT 0;

-- 2. Aggiorna i valori NULL con i default
UPDATE tenants SET app_limit = 0 WHERE app_limit IS NULL;
UPDATE tenants SET total_apps_created = 0 WHERE total_apps_created IS NULL;

-- 3. Imposta app_limit in base al piano (valori base)
-- NOTA: Questi sono i valori base, gli slot vengono aggiunti cumulativamente
-- quando l'utente acquista un piano tramite webhook Stripe
-- I tenant con plan='free' o senza piano devono avere 0 slot
UPDATE tenants
SET app_limit = CASE 
  WHEN plan = 'free' OR plan IS NULL THEN 0
  WHEN plan = 'starter' THEN 1
  WHEN plan = 'pro' THEN 5
  WHEN plan = 'business' THEN 100
  ELSE 0
END
WHERE app_limit = 0;

-- 4. Verifica lo stato
SELECT 
  id,
  name,
  plan,
  app_limit,
  total_apps_created,
  (app_limit - total_apps_created) AS slots_available
FROM tenants;

-- 5. Commenti
COMMENT ON COLUMN tenants.app_limit IS 'Slot totali disponibili (somma cumulativa di tutti gli slot acquistati)';
COMMENT ON COLUMN tenants.total_apps_created IS 'Contatore permanente di tutte le app create (non decrementa mai)';

-- 6. Funzione per aggiungere slot (da chiamare quando l'utente acquista un piano)
-- Questa funzione può essere chiamata dal webhook Stripe quando l'utente paga
CREATE OR REPLACE FUNCTION add_tenant_slots(tenant_id UUID, slots_to_add INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE tenants
  SET app_limit = app_limit + slots_to_add,
      updated_at = NOW()
  WHERE id = tenant_id;
END;
$$ LANGUAGE plpgsql;

-- 7. Funzione per ottenere gli slot disponibili
CREATE OR REPLACE FUNCTION get_tenant_slots_available(tenant_id UUID)
RETURNS INTEGER AS $$
DECLARE
  available INTEGER;
BEGIN
  SELECT (app_limit - total_apps_created) INTO available
  FROM tenants
  WHERE id = tenant_id;
  
  RETURN COALESCE(available, 0);
END;
$$ LANGUAGE plpgsql;