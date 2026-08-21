-- ============================================================================
-- ShardApps - CreatorAI V4 P0 fix: generazione asincrona + idempotenza
-- Data: 2026-08-31
-- ============================================================================
-- Root cause (validazione live V4, vedi report): POST /api/creator/generate
-- teneva la connessione HTTP aperta per l'intera durata della pipeline
-- (planner -> generator -> validator -> repair, fino a ~180s). Il client
-- interrompeva la connessione per un limite di piattaforma prima che il
-- server finisse, mostrando un falso "Errore di connessione" mentre il job
-- continuava e completava comunque — nessun modo per il client di recuperare
-- quel risultato, nessuna protezione contro un secondo tentativo dell'utente
-- che crea una app duplicata.
--
-- Due colonne aggiuntive sulla generation_jobs GIA' esistente (migration
-- 20260823000000) — non un secondo sistema di job:
--
-- - result_schema: il blueprint finale pronto per la UI (stessa forma che
--   prima veniva restituita direttamente nel body della risposta HTTP),
--   valorizzato SOLO quando status='ready'. Separato da `specification`
--   (AppSpecification, uso interno di validazione) per non toccare il
--   comportamento/i test esistenti su quella colonna.
-- - prompt_fingerprint: hash deterministico di tenant+utente+projectType+
--   lang+prompt normalizzato, calcolato lato applicativo (creator-generation-
--   jobs.ts). Permette di trovare un job equivalente già in corso o appena
--   completato PRIMA di crearne uno nuovo (POST /api/creator/generate),
--   evitando la doppia app quando l'utente ritenta dopo un falso errore.
-- ============================================================================

ALTER TABLE generation_jobs
  ADD COLUMN IF NOT EXISTS result_schema jsonb,
  ADD COLUMN IF NOT EXISTS prompt_fingerprint text;

-- Filtrato (WHERE prompt_fingerprint IS NOT NULL): i job storici pre-fix
-- restano NULL per questa colonna e non partecipano mai alla ricerca di
-- idempotenza, nessuna migrazione retroattiva necessaria.
CREATE INDEX IF NOT EXISTS idx_generation_jobs_idempotency
  ON generation_jobs(tenant_id, created_by, prompt_fingerprint, created_at DESC)
  WHERE prompt_fingerprint IS NOT NULL;

COMMENT ON COLUMN generation_jobs.result_schema IS 'Blueprint finale (SiteBlueprintJSON con businessConfig defaults applicati) pronto per la UI, valorizzato solo quando status=''ready''. Vedi frontend/app/api/creator/generate/route.ts.';
COMMENT ON COLUMN generation_jobs.prompt_fingerprint IS 'Hash SHA-256 di tenant_id+created_by+projectType+lang+prompt normalizzato, per la ricerca di idempotenza pre-creazione job. Vedi findRecentEquivalentJob in creator-generation-jobs.ts.';

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
