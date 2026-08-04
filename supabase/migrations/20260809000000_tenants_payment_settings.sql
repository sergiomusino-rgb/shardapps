-- ============================================================================
-- ZeusX - Motore "Comandi": modulo pagamenti online opzionale Plug & Play
-- Data: 2026-08-09
-- Descrizione: aggiunge a tenants i campi del modulo pagamenti opzionale già
-- introdotto per le app generate (apps.config.paymentSettings, vedi
-- backend/routes/client-app.js). Comandi AI non ha un config JSONB per
-- tenant: segue invece il pattern già in uso qui (colonne dirette, vedi
-- 20260731000000_add_company_fields_to_tenants.sql e
-- 20260808000010_tenants_logo_url.sql), scritte solo dalla Server Action
-- setupTenantAction (frontend/app/actions/comandi-tenant.ts) e mostrate nella
-- scheda Azienda (ComandiInstanceDashboard.tsx, CompanyTab). A differenza di
-- `apps`, `tenants` non è mai esposta ad anon (RLS "tenants_select_member"
-- richiede membership autenticata): nessuno dei problemi di grant-per-colonna
-- già visti su apps si applica qui.
-- ============================================================================

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payments_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_payment_link TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_public_key TEXT;

COMMENT ON COLUMN tenants.payments_enabled IS 'Modulo pagamenti online opzionale (Comandi AI): se true e stripe_payment_link è valorizzato, mostra "Paga Ora" nei documenti del tenant';
COMMENT ON COLUMN tenants.stripe_payment_link IS 'Stripe Payment Link del tenant (https://buy.stripe.com/... o checkout.stripe.com/...). ZeusX non gestisce mai le transazioni: il link porta direttamente al checkout Stripe del tenant';
COMMENT ON COLUMN tenants.stripe_public_key IS 'Publishable key Stripe (pk_test_.../pk_live_...) del tenant, riservata a un futuro checkout incorporato. Mai la secret key';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
