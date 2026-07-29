-- ============================================================================
-- ZeusX - Add role column to profiles table
-- Data: 2026-07-15
-- Descrizione: Aggiunge il campo role alla tabella profiles per RBAC
-- ============================================================================

-- 1. Aggiungi colonna role se non esiste
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'viewer' 
CHECK (role IN ('admin', 'reseller', 'viewer', 'editor'));

-- 2. Aggiungi colonna subscription_plan se non esiste
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT 'free' 
CHECK (subscription_plan IN ('free', 'starter', 'pro', 'business'));

-- 3. Indice per il role
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

-- 4. Commenti
COMMENT ON COLUMN profiles.role IS 'User role: admin, reseller, viewer, editor';
COMMENT ON COLUMN profiles.subscription_plan IS 'Subscription plan: free, starter, pro, business';

-- 5. Imposta il ruolo admin per l'utente amministratore
-- Sostituisci con l'UUID reale dell'amministratore
UPDATE profiles 
SET role = 'admin' 
WHERE user_id = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5' 
AND role != 'admin';