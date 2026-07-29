-- ============================================================================
-- ZeusX - Create profiles table
-- Data: 2026-07-17
-- Descrizione: Crea la tabella profiles per memorizzare i metadati utente
-- ============================================================================

-- 1. Crea la tabella profiles (se non esiste)
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    full_name TEXT,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'reseller', 'viewer', 'editor')),
    subscription_plan TEXT NOT NULL DEFAULT 'free' CHECK (subscription_plan IN ('free', 'starter', 'pro', 'business')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 1b. Aggiungi colonne mancanti se la tabella esiste già
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_plan TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- 1c. Imposta valori di default per le colonne esistenti
ALTER TABLE profiles ALTER COLUMN role SET DEFAULT 'viewer';
ALTER TABLE profiles ALTER COLUMN subscription_plan SET DEFAULT 'free';
ALTER TABLE profiles ALTER COLUMN updated_at SET DEFAULT now();

-- 1d. Aggiorna i valori NULL con i default
UPDATE profiles SET role = 'viewer' WHERE role IS NULL;
UPDATE profiles SET subscription_plan = 'free' WHERE subscription_plan IS NULL;
UPDATE profiles SET updated_at = now() WHERE updated_at IS NULL;

-- 1e. Imposta le colonne come NOT NULL (solo se non lo sono già)
-- Nota: Questo può fallire se ci sono valori NULL, ma dovrebbero essere stati aggiornati al passo 1d
-- ALTER TABLE profiles ALTER COLUMN role SET NOT NULL;
-- ALTER TABLE profiles ALTER COLUMN subscription_plan SET NOT NULL;

-- 1f. Commenti
COMMENT ON TABLE profiles IS 'Profili utente con ruoli e piani di abbonamento';
COMMENT ON COLUMN profiles.role IS 'Ruolo: admin, reseller, viewer, editor';
COMMENT ON COLUMN profiles.subscription_plan IS 'Piano di abbonamento: free, starter, pro, business';

-- 2. Indici
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

-- 3. Funzione per updated_at (se non esiste)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Trigger per updated_at
DROP TRIGGER IF EXISTS tr_profiles_updated_at ON profiles;
CREATE TRIGGER tr_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5. RLS (Row Level Security)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Policy: gli utenti possono vedere e modificare i propri record
DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT WITH CHECK (user_id = auth.uid());

-- 6. Trigger per creare automaticamente il profilo alla registrazione
-- Nota: Questo richiede la funzione handle_new_user() se non esiste
-- CREATE OR REPLACE FUNCTION handle_new_user() 
-- RETURNS TRIGGER AS $$
-- BEGIN
--     INSERT INTO profiles (user_id, email)
--     VALUES (NEW.id, NEW.email);
--     RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql SECURITY DEFINER;
-- 
-- CREATE TRIGGER on_auth_user_created
--     AFTER INSERT ON auth.users
--     FOR EACH ROW EXECUTE FUNCTION handle_new_user();
