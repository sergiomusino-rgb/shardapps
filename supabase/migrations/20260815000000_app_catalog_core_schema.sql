-- ============================================================================
-- ShardApps - App Catalog & Instance Model (STEP 2 — schema core)
-- Data: 2026-08-15
-- ============================================================================
-- Segue lo STEP 1 (audit read-only, nessuna riga eseguita): introduce un
-- catalogo prodotti GLOBALE e a livello di piattaforma (slug come 'command-ai',
-- 'follow-ai', 'check-ai' — NON un catalogo per-tenant/marketplace dove i
-- tenant pubblicano i propri blueprint gli uni per gli altri). Per questo
-- app_products NON ha una colonna tenant_id: è gestito esclusivamente lato
-- service_role/admin, letto in sola lettura da chi è autenticato — stesso
-- principio già usato per `blueprints` (catalogo globale per settore del
-- vecchio motore tabellare), ma per il motore CreatorAI (SiteBlueprintJSON)
-- e con versionamento esplicito, che `blueprints` non ha mai avuto.
--
-- Relazione con `blueprints` (creator-v1, 20250626000000): tabella distinta,
-- NON sostituita né toccata da questa migration. `blueprints` resta il
-- catalogo "1 riga per settore" del motore tabellare legacy
-- (frontend/app/api/apps/route.ts); app_products/app_product_versions sono
-- il catalogo del motore CreatorAI attuale, con versionamento reale.
--
-- Retrocompatibilità: additiva al 100%. Le due tabelle sono nuove; su `apps`
-- si aggiungono solo colonne NULLABLE o con DEFAULT — nessuna riga esistente
-- richiede backfill, nessuna app già pubblicata viene toccata. Ogni app
-- pubblicata dal flusso CreatorAI attuale (frontend/app/api/creator/publish/
-- route.ts) continua a nascere con product_id/product_version_id = NULL,
-- esattamente come oggi: è una "pubblicazione singola", non un'installazione
-- da catalogo — quel collegamento è previsto per lo STEP 3 (endpoint di
-- installazione), non creato qui.
-- ============================================================================

-- ─── app_products ────────────────────────────────────────────────────────
-- Un "prodotto" del catalogo ShardApps (es. Comandi AI, Follow AI, Check AI):
-- riga gestita da chi amministra la piattaforma, mai da un tenant.
CREATE TABLE IF NOT EXISTS app_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  category TEXT,
  price_monthly NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  trial_days INTEGER NOT NULL DEFAULT 30,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE app_products IS 'Catalogo prodotti globale di piattaforma (App Catalog & Instance Model, STEP 2) — gestito da service_role/admin, mai da un tenant. Distinto da `blueprints` (motore tabellare legacy, 1 riga per settore, non versionato).';

-- ─── app_product_versions ───────────────────────────────────────────────
-- Versioni distribuibili di un prodotto: `blueprint` è lo SiteBlueprintJSON
-- congelato (stessa forma di apps.config oggi) per quella versione — mai
-- modificato dopo la creazione, una nuova modifica richiede una nuova riga
-- (nuova versione), non un UPDATE di una esistente.
CREATE TABLE IF NOT EXISTS app_product_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES app_products(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  blueprint JSONB NOT NULL,
  changelog TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, version)
);

CREATE INDEX IF NOT EXISTS idx_app_product_versions_product_id ON app_product_versions(product_id);

COMMENT ON TABLE app_product_versions IS 'Versioni congelate/distribuibili di un app_products (App Catalog & Instance Model, STEP 2). `blueprint` è immutabile dopo la creazione: una modifica successiva è sempre una nuova riga/versione, mai un UPDATE.';

-- ─── Estensione apps (istanze) ──────────────────────────────────────────
-- product_id/product_version_id: NULL per ogni app esistente e per ogni
-- futura pubblicazione "singola" (non da catalogo) — stesso comportamento
-- di oggi, invariato. Valorizzati solo dal futuro endpoint di installazione
-- da catalogo (STEP 3, non creato qui).
ALTER TABLE apps ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES app_products(id) ON DELETE SET NULL;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS product_version_id UUID REFERENCES app_product_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_apps_product_id ON apps(product_id);

-- subscription_status: stato di abbonamento specifico per un'istanza
-- installata da catalogo. NOTA — sovrapposizione nota e deliberata con
-- `apps.status` (CHECK esistente: trial/active/past_due/canceled/expired,
-- vedi 20260728000000_fix_apps_status_check_missing_expired.sql), già
-- segnalata nello STEP 1 come debito tecnico storico (trial_ends_at/
-- trial_end/expires_at hanno la stessa sovrapposizione): questa colonna
-- NON sostituisce `status`, resta scoperta finché non verrà deciso come
-- riconciliare i due — per ora convivono, `status` per il ciclo di vita
-- generale dell'app, `subscription_status` per il ciclo di vita specifico
-- di un'istanza da catalogo (product_id IS NOT NULL). Vocabolario diverso
-- di proposito ('trialing' invece di 'trial'): è lo stesso usato da Stripe
-- Subscriptions, per restare coerente quando la fatturazione per-istanza
-- verrà collegata (fuori scope qui).
ALTER TABLE apps ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE apps DROP CONSTRAINT IF EXISTS apps_subscription_status_check;
ALTER TABLE apps ADD CONSTRAINT apps_subscription_status_check
  CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'canceled'));

-- trial_ends_at NON viene aggiunta: esiste già su `apps` dalla migration
-- 20250626000001 (TIMESTAMPTZ NOT NULL DEFAULT now()+30gg) e serve
-- esattamente allo stesso scopo richiesto qui. Aggiungerla di nuovo
-- (ADD COLUMN IF NOT EXISTS) sarebbe un no-op silenzioso che non
-- cambierebbe la sua nullability né il default — scritta qui come
-- promemoria esplicito invece che come statement fuorviante nel file.

COMMENT ON COLUMN apps.product_id IS 'App Catalog & Instance Model (STEP 2): prodotto da cui questa istanza è stata installata, NULL per le pubblicazioni singole (comportamento invariato per tutte le app esistenti e per ogni nuova pubblicazione CreatorAI non da catalogo).';
COMMENT ON COLUMN apps.product_version_id IS 'App Catalog & Instance Model (STEP 2): versione esatta del prodotto installata — congela il blueprint di origine indipendentemente da versioni successive dello stesso prodotto.';
COMMENT ON COLUMN apps.subscription_status IS 'Stato di abbonamento specifico per un''istanza da catalogo (product_id IS NOT NULL). Sovrapposizione nota e deliberata con apps.status, vedi commento sopra alla colonna — non ancora riconciliati.';

-- ─── RLS ─────────────────────────────────────────────────────────────────
-- Catalogo leggibile da chiunque sia autenticato (è un catalogo da
-- sfogliare per decidere cosa installare, non un dato riservato per-tenant
-- come app_credentials/app_rbac_users/app_action_logs) — ma scrivibile
-- SOLO da service_role: nessuna policy INSERT/UPDATE/DELETE per
-- anon/authenticated qui sotto è intenzionale, non un buco (stesso
-- principio già documentato per tenant_members in
-- backend/scripts/check_rls_policies.js: un array vuoto di policy
-- permissive per un comando = scrittura sempre negata per chi non è
-- service_role, che bypassa RLS by design).
ALTER TABLE app_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_product_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_products_select_active" ON app_products FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE POLICY "app_product_versions_select_active" ON app_product_versions FOR SELECT
  TO authenticated
  USING (is_active = true);

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
