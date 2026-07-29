-- ============================================================================
-- ZeusX - Fix apps_status_check: reintroduce 'expired'
-- Data: 2026-07-28
-- Descrizione: 20260723_update_apps_for_reseller_checkout.sql ha sostituito
-- apps_status_check con CHECK (status IN ('trial','active','past_due',
-- 'canceled')), rimuovendo 'expired' dai valori ammessi. Il trigger
-- tr_apps_status_check (20260718_add_payment_fields_to_apps.sql) però
-- imposta ancora NEW.status = 'expired' quando un trial scade, e il
-- frontend usa ancora attivamente 'expired' come stato distinto
-- (app/a/[slug]/layout.tsx isAppBlocked, dashboard/management/page.tsx,
-- api/admin/stats/route.ts, settings/page.tsx). Risultato: qualsiasi UPDATE
-- su un'app in trial con trial_ends_at nel passato falliva sempre con
-- "new row for relation apps violates check constraint apps_status_check"
-- (riprodotto e confermato durante lo stress-test E2E multi-tenant).
-- ============================================================================

ALTER TABLE apps DROP CONSTRAINT IF EXISTS apps_status_check;

ALTER TABLE apps
ADD CONSTRAINT apps_status_check
CHECK (status IN ('trial', 'active', 'past_due', 'canceled', 'expired'));

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
