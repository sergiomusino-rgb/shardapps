-- ============================================================================
-- ZeusX - Unifica la gestione del trial su trial_ends_at
-- Data: 2026-07-29
-- Descrizione: apps aveva due colonne di scadenza trial scollegate:
-- trial_ends_at (quella reale, usata dal paywall in app/a/[slug]/layout.tsx
-- e da Creator AI) e trial_end (aggiunta separatamente in
-- 20260723_update_apps_for_reseller_checkout.sql, auto-popolata da un
-- trigger a partire da trial_start, mai valorizzata dalle app create via
-- Creator AI). Il codice non legge più trial_end da nessuna parte (era
-- selezionata solo in app/api/apps/checkout/route.ts e
-- app/api/apps/checkout/managed/route.ts senza mai essere usata in nessuna
-- logica) — rimuoviamo qui il trigger che la manteneva, invece di lasciarla
-- divergere ulteriormente da trial_ends_at. Le colonne trial_start/trial_end
-- non vengono droppate (nessun dato viene perso), solo l'auto-popolamento.
-- ============================================================================

DROP TRIGGER IF EXISTS tr_apps_trial_end ON apps;
DROP FUNCTION IF EXISTS update_trial_end();

COMMENT ON COLUMN apps.trial_end IS 'Deprecata: sostituita da trial_ends_at, non più auto-popolata. Mantenuta solo per compatibilità con dati storici.';
COMMENT ON COLUMN apps.trial_start IS 'Deprecata: nessun codice la legge più, era usata solo per calcolare trial_end.';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
