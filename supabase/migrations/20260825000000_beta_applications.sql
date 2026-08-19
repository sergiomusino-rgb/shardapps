-- ============================================================================
-- ShardApps - Fase 1B: Private Beta reseller, persistenza candidature
-- Data: 2026-08-25
-- ============================================================================
-- Candidature dal form pubblico /beta (frontend/app/beta/BetaApplicationForm.tsx)
-- via POST /api/beta/apply — mai un insert diretto dal browser (vedi RLS
-- sotto): l'endpoint usa la service role key, mai esposta al client.
--
-- Schema/nullabilità dei campi facoltativi (website/country/business_type/
-- client_count/app_types/expected_apps/message) come da richiesta esplicita:
-- la route valida questi campi come obbligatori a livello applicativo (vedi
-- app/api/beta/apply/route.ts), il DB resta più permissivo di proposito così
-- da non dover toccare questa migration se in futuro un campo diventa
-- opzionale lato prodotto.
--
-- RLS: stesso pattern deny-all già usato per generation_jobs/app_versions/
-- app_action_logs — nessun accesso diretto dalla Data API pubblica (né anon
-- né authenticated), solo dalla route server-side con service role.
-- ============================================================================

CREATE TABLE IF NOT EXISTS beta_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  full_name text NOT NULL,
  company_name text NOT NULL,
  email text NOT NULL,
  website text,
  country text,
  business_type text,
  client_count text,
  app_types text,
  expected_apps text,
  message text,

  -- Stato di revisione interna (nessuna dashboard admin ancora — Fase 1B si
  -- ferma alla persistenza corretta, vedi task): il campo esiste già così
  -- una futura dashboard non richiede un'altra migration solo per questo.
  status text NOT NULL DEFAULT 'new',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT beta_applications_status_check
    CHECK (status IN ('new', 'reviewing', 'approved', 'rejected', 'contacted')),

  -- Constraint "ragionevoli": stessi valori enum del form (BetaApplicationForm.tsx)
  -- e della validazione server-side, più un tetto di lunghezza per ogni
  -- campo testuale libero — difesa in profondità, la route rifiuta già un
  -- payload fuori misura con 400 prima di arrivare qui.
  CONSTRAINT beta_applications_business_type_check
    CHECK (business_type IS NULL OR business_type IN ('agency', 'freelancer', 'reseller', 'other')),
  CONSTRAINT beta_applications_client_count_check
    CHECK (client_count IS NULL OR client_count IN ('1-10', '11-50', '51-100', '100+')),
  CONSTRAINT beta_applications_expected_apps_check
    CHECK (expected_apps IS NULL OR expected_apps IN ('1-3', '4-10', '10+')),
  CONSTRAINT beta_applications_email_format_check
    CHECK (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT beta_applications_full_name_length_check CHECK (char_length(full_name) BETWEEN 1 AND 200),
  CONSTRAINT beta_applications_company_name_length_check CHECK (char_length(company_name) BETWEEN 1 AND 200),
  CONSTRAINT beta_applications_email_length_check CHECK (char_length(email) BETWEEN 3 AND 320),
  CONSTRAINT beta_applications_website_length_check CHECK (website IS NULL OR char_length(website) <= 300),
  CONSTRAINT beta_applications_country_length_check CHECK (country IS NULL OR char_length(country) <= 100),
  CONSTRAINT beta_applications_app_types_length_check CHECK (app_types IS NULL OR char_length(app_types) <= 2000),
  CONSTRAINT beta_applications_message_length_check CHECK (message IS NULL OR char_length(message) <= 2000)
);

-- Dedup case-insensitive: stessa email (a prescindere da maiuscole/minuscole)
-- non può comparire due volte. Difesa in profondità rispetto al controllo
-- "esiste già" fatto dalla route PRIMA dell'insert — questo indice è quello
-- che garantisce l'assenza di duplicati anche in caso di due richieste
-- concorrenti per la stessa email (race condition sul controllo applicativo).
CREATE UNIQUE INDEX IF NOT EXISTS beta_applications_email_unique_idx
  ON beta_applications (lower(email));

CREATE INDEX IF NOT EXISTS idx_beta_applications_created_at ON beta_applications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_beta_applications_status ON beta_applications (status);

ALTER TABLE beta_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "beta_applications_deny_anon_authenticated" ON beta_applications;
CREATE POLICY "beta_applications_deny_anon_authenticated" ON beta_applications FOR ALL
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE beta_applications IS 'Candidature Private Beta reseller dal form pubblico /beta — Fase 1B. Solo insert server-side (service role), vedi app/api/beta/apply/route.ts.';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
