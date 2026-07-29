-- ============================================================================
-- ZeusX - Trial owner per-app sulla fee di 25€/mese (Merchant of Record)
-- Data: 2026-08-07
-- Descrizione: la fee ricorrente di 25€/app (backend/routes/stripe.js,
-- /update-app-fee) non deve partire da un'unica finestra di 30 giorni legata
-- all'acquisto del piano (tenant), ma per singola app, dal primo login
-- dell'owner in quella specifica app. NULL finché l'owner non ha mai fatto
-- login; valorizzato a NOW() + 30 giorni al primo accesso (vedi
-- mark-first-login/route.ts, verify-password/route.ts, AuthContext.tsx).
-- ============================================================================

ALTER TABLE apps ADD COLUMN IF NOT EXISTS owner_trial_ends_at TIMESTAMPTZ;

COMMENT ON COLUMN apps.owner_trial_ends_at IS 'NULL finché l''owner non ha mai fatto login nell''app. Impostato a NOW() + 30 giorni al primo login: da quel momento, se l''app non è stata rivenduta a un cliente pagante (status != ''active''), scaduto questo termine l''app conta nella fee di 25€/mese addebitata al tenant.';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
