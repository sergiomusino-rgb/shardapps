-- ============================================================================
-- ShardApps - App Catalog & Instance Model (STEP 4 — stripe_customer_id su apps)
-- Data: 2026-08-17
-- ============================================================================
-- Verificato prima di scrivere questa migration (STEP 4, analisi read-only):
-- `apps` non ha mai avuto una colonna stripe_customer_id — solo
-- stripe_subscription_id (20260723000000_update_apps_for_reseller_checkout.sql).
-- stripe_customer_id esiste SOLO su `subscriptions` da sempre
-- (20250626000001_create_multitenant_schema.sql in poi), che è un customer
-- semanticamente diverso: quello della subscription reseller/piattaforma del
-- tenant (UNIQUE(tenant_id), 1 per tenant). Una Catalog Instance (STEP 3,
-- apps.product_id IS NOT NULL) è invece fatturata direttamente al tenant come
-- singola app (stesso modello di stripe_subscription_id su apps), quindi ha
-- bisogno di un customer Stripe proprio, non condiviso con
-- subscriptions.stripe_customer_id.
--
-- Uso (STEP 4): scritta dal webhook Stripe esistente
-- (backend/lib/stripe-webhook-handler.js::updateAppStatus) quando disponibile
-- nell'evento, SOLO per righe con product_id IS NOT NULL — per ogni altra
-- app (product_id NULL: pubblicazioni CreatorAI singole/app-cliente
-- reseller) il comportamento resta quello di sempre, questa colonna
-- semplicemente non viene mai scritta per loro in questo step.
--
-- Additiva al 100%: colonna NULLABLE, nessun DEFAULT, nessuna riga esistente
-- toccata, nessun backfill. RLS invariata: nessuna nuova policy su `apps` —
-- stesse regole già in vigore (scrittura solo da service_role sui percorsi
-- applicativi server-side, lettura tenant-scoped via
-- apps_select_tenant_member, 20260630000011_rls_policies_auth_uid.sql).
-- ============================================================================

ALTER TABLE apps ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

CREATE INDEX IF NOT EXISTS idx_apps_stripe_customer_id ON apps(stripe_customer_id);

COMMENT ON COLUMN apps.stripe_customer_id IS 'ID Stripe Customer associato a QUESTA specifica istanza (App Catalog STEP 4) — scritto dal webhook Stripe (backend/lib/stripe-webhook-handler.js::updateAppStatus) quando disponibile nell''evento, solo per righe con product_id IS NOT NULL (Catalog Instance). Distinto da subscriptions.stripe_customer_id (customer della subscription reseller/piattaforma, 1 per tenant): un tenant può avere un customer Stripe diverso per ciascuna Catalog Instance sottoscritta direttamente, oltre al proprio customer di piattaforma.';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
