-- Verifica stato attuale
SELECT 
  id,
  plan,
  app_limit,
  email
FROM tenants
WHERE id = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';

-- Fix: imposta app_limit corretto in base al piano
-- STARTER = 1 app, PRO = 5 app, BUSINESS = 100 app
UPDATE tenants
SET app_limit = CASE
  WHEN plan = 'starter' THEN 1
  WHEN plan = 'pro' THEN 5
  WHEN plan = 'business' THEN 100
  ELSE 1
END
WHERE id = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';

-- Verifica risultato
SELECT 
  id,
  plan,
  app_limit
FROM tenants
WHERE id = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';
