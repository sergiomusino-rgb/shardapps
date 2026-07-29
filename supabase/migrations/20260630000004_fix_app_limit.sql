-- Fix app_limit per il tenant specifico
-- Questo risolve il problema degli "slot negativi" (-2 slot disponibili)

-- Verifica stato attuale prima del fix
SELECT 
  id,
  plan,
  app_limit,
  total_apps_created
FROM tenants
WHERE id = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';

-- Fix: imposta app_limit corretto in base al piano
-- STARTER = 1 app, PRO = 5 app, BUSINESS = 250 app
UPDATE tenants
SET app_limit = CASE 
  WHEN plan = 'starter' THEN 1
  WHEN plan = 'pro' THEN 5
  WHEN plan = 'business' THEN 250
  WHEN plan = 'free' THEN 1
  ELSE 1
END,
updated_at = NOW()
WHERE id = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';

-- Verifica risultato dopo il fix
SELECT 
  id,
  plan,
  app_limit,
  total_apps_created,
  (app_limit - total_apps_created) AS slots_available
FROM tenants
WHERE id = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';