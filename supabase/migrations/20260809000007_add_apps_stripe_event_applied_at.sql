-- ============================================================================
-- ShardApps - Colonna dedicata per la guardia anti-fuori-ordine su apps
-- Data: 2026-08-09
-- Descrizione: apps.updated_at non è un riferimento affidabile per
-- isStaleEvent (backend/lib/stripe-webhook-logic.js) - a differenza di
-- subscriptions (scritta SOLO da codice legato a Stripe: backend/server.js,
-- backend/routes/stripe.js, frontend/app/api/webhooks/stripe/route.ts),
-- apps viene scritta da 15+ percorsi applicativi non legati a Stripe
-- (backend/jobs/expiry-check.js - cron giornaliero automatico -,
-- verify-password, mark-first-login, apps/[id]/client-access,
-- creator/publish, update-credentials, admin/takeover, ecc.), e il trigger
-- tr_apps_updated_at (20260630000009_master_schema_fix.sql) sovrascrive
-- updated_at su QUALUNQUE update, a prescindere da quali colonne cambino.
--
-- Falso positivo concreto: se una di queste scritture non-Stripe avviene
-- anche pochi secondi dopo l'event.created di un evento Stripe legittimo ma
-- consegnato in ritardo, isStaleEvent lo scarterebbe come "fuori ordine" -
-- un rinnovo pagato non verrebbe mai applicato, silenziosamente.
--
-- Fix: apps.stripe_event_applied_at, scritta SOLO da updateAppStatus
-- (backend/server.js) con event.created dell'evento Stripe che l'ha
-- prodotta - mai toccata da nessun altro percorso applicativo né dal
-- trigger generico di updated_at. isStaleEvent confronta ora l'evento
-- in arrivo contro questa colonna, non più contro updated_at.
--
-- DEFAULT NULL: le righe esistenti non hanno ancora un riferimento Stripe
-- tracciato qui - isStaleEvent tratta un riferimento NULL come "non fuori
-- ordine" (nulla con cui confrontare), quindi il primo evento Stripe
-- ricevuto dopo il rilascio di questa migrazione viene sempre applicato
-- normalmente, non bloccato.
-- ============================================================================

ALTER TABLE apps ADD COLUMN IF NOT EXISTS stripe_event_applied_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN apps.stripe_event_applied_at IS 'Timestamp (event.created) dell''ultimo evento webhook Stripe applicato a questa riga - scritta SOLO da updateAppStatus in backend/server.js, usata dalla guardia anti-fuori-ordine isStaleEvent invece di updated_at (che su questa tabella viene bumpato anche da scritture non legate a Stripe)';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
