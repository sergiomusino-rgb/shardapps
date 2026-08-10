-- ============================================================================
-- ZeusX - Ownership dei progetti Totalum in corso di generazione
-- Data: 2026-08-10
-- ============================================================================
-- Fase 5A/5B (audit post-merge Finding #1-8): la pagina
-- frontend/app/dashboard/generator/attesa/[projectId]/page.tsx interrogava
-- l'API Totalum DIRETTAMENTE dal browser con una chiave duplicata in
-- NEXT_PUBLIC_TOTALUM_API_KEY (quindi presente in chiaro nel bundle JS
-- pubblico — confermato in .next/static/). La chiave viene ora rimossa dal
-- client: le chiamate passano da due proxy server-side
-- (frontend/app/api/generate/status e /project), che devono però poter
-- verificare che il projectId Totalum richiesto appartenga davvero
-- all'utente/tenant che lo interroga — nessuna struttura esistente lo
-- permetteva: apps.totalum_app_id viene scritto solo a generazione
-- COMPLETATA (generate/save/route.ts), quindi durante il polling (l'unica
-- finestra in cui questi proxy servono) non esiste ancora alcuna riga in
-- apps da cui risalire al proprietario.
--
-- Questa tabella registra quindi, SUBITO dopo la creazione del progetto su
-- Totalum (prima del polling, in generate/route.ts e backend/routes/
-- generate.js), chi lo ha richiesto. Riga volutamente minima ed effimera
-- (nessun bisogno di conservarla oltre la finestra di generazione): non è
-- referenziata da apps.id apposta, per non introdurre un vincolo verso una
-- riga che potrebbe non esistere ancora.
--
-- Stesso pattern deny-all già in uso per app_credentials (20260808000004) e
-- app_password_reset_tokens (20260809000008): nessun accesso diretto per
-- anon/authenticated, solo service_role (bypassa RLS) può leggere/scrivere,
-- dato che sia la creazione sia i proxy di lettura girano lato server con
-- quella chiave.
-- ============================================================================

CREATE TABLE IF NOT EXISTS totalum_generation_requests (
  project_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Nullable: il bypass ADMIN_USER_ID in frontend/app/api/generate/route.ts
  -- salta la risoluzione del tenant. L'ownership per queste righe si
  -- verifica quindi solo per user_id (vedi
  -- totalum-generation-authorization.js).
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS totalum_generation_requests_tenant_id_idx
  ON totalum_generation_requests (tenant_id);

ALTER TABLE totalum_generation_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "totalum_generation_requests_deny_anon_authenticated" ON totalum_generation_requests FOR ALL
  USING (false)
  WITH CHECK (false);

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
