-- ============================================================================
-- ZeusX - Stress-test pre-lancio finale: chiude 3 falle reali trovate live
-- Data: 2026-08-08
-- ============================================================================
--
-- 1) apps.client_password / apps.initial_password erano di nuovo leggibili in
--    chiaro da anon/authenticated via REST diretta (es. GET /rest/v1/apps?
--    select=client_password), nonostante il REVOKE di
--    20260723000002_lockdown_apps_credentials_and_subscriptions.sql: quel
--    REVOKE usava una sintassi non valida per privilegi a livello di colonna
--    (`REVOKE SELECT, INSERT, UPDATE (col1, col2) ...` — in Postgres ogni
--    verbo deve avere la propria lista di colonne: `SELECT (col1, col2),
--    INSERT (col1, col2), UPDATE (col1, col2)`), quindi non aveva mai
--    revocato nulla. Verificato dal vivo: 157 righe di apps, con
--    client_password/initial_password in chiaro, leggibili con la sola anon
--    key pubblica (quella già presente nel bundle del frontend).
--
-- 2) Stesso problema per client_phone/client_tax_id/client_billing_address:
--    dati di contatto e fiscali del cliente finale, leggibili da chiunque.
--    A differenza di client_email (necessario alla pagina di login pubblica
--    /a/[slug] prima dell'autenticazione, vedi LegacyLoginGate) e degli altri
--    campi già usati da anon, questi tre non servono mai al flusso anonimo:
--    revocati solo per anon, restano disponibili per authenticated (usati da
--    dashboard/projects/[id] e dashboard/management per i proprietari tenant,
--    protetti a livello di riga dalle policy RLS esistenti su tenant_id).
--
-- 3) Le tabelle `chats` e `messages` (non referenziate da nessun percorso di
--    codice attuale in frontend/ o backend/ — sembrano residuati di un
--    prototipo pre-AI-router) avevano policy SELECT/INSERT con USING(true)/
--    WITH CHECK(true) per anon E authenticated: chiunque, senza nemmeno
--    effettuare il login, poteva leggere il contenuto testuale completo di
--    OGNI conversazione AI di OGNI utente (messages.content) e inserire righe
--    arbitrarie. La policy "Users see own messages" esistente su messages era
--    inoltre inefficace (chat_id = auth.uid() confronta l'id di una chat con
--    l'id di un utente: condizione quasi sempre falsa, e comunque in OR con
--    la policy permissiva che la rendeva irrilevante). Non essendo la tabella
--    in uso da nessuna funzionalità attiva, si applica lo stesso pattern già
--    adottato per subscriptions/app_registry/transactions/
--    processed_checkout_sessions: USING(false)/WITH CHECK(false) per
--    anon/authenticated (service_role bypassa comunque RLS).
--
-- 4) _system_entities: policy "service_role_full_access" con USING(true)/
--    WITH CHECK(true) ma SENZA clausola TO (quindi valida per "public", non
--    solo per service_role) — stesso refuso già visto altrove. Tabella non
--    referenziata da alcun percorso applicativo (solo nei tipi generati);
--    corretta comunque restringendo esplicitamente a service_role.
-- ============================================================================

-- ─── 1) apps: credenziali mai leggibili/scrivibili da anon o authenticated ──

REVOKE SELECT (client_password, initial_password),
       INSERT (client_password, initial_password),
       UPDATE (client_password, initial_password)
  ON apps FROM anon, authenticated;

-- ─── 2) apps: PII di contatto/fiscale mai leggibile da anon (anonimo) ───────

REVOKE SELECT (client_phone, client_tax_id, client_billing_address),
       INSERT (client_phone, client_tax_id, client_billing_address),
       UPDATE (client_phone, client_tax_id, client_billing_address)
  ON apps FROM anon;

-- ─── 3) chats / messages: tabelle orfane, mai usate da codice attuale ──────
-- Chiuse del tutto per anon/authenticated finché non torneranno in uso con
-- policy scritte per lo schema reale (chats.user_id, messages.chat_id).

DROP POLICY IF EXISTS "Consenti inserimento" ON chats;
DROP POLICY IF EXISTS "Consenti lettura" ON chats;

CREATE POLICY "chats_deny_anon_authenticated" ON chats FOR ALL
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "Consenti inserimento messaggi" ON messages;
DROP POLICY IF EXISTS "Consenti lettura messaggi" ON messages;
DROP POLICY IF EXISTS "Users see own messages" ON messages;

CREATE POLICY "messages_deny_anon_authenticated" ON messages FOR ALL
  USING (false)
  WITH CHECK (false);

-- ─── 4) _system_entities: restringe esplicitamente a service_role ──────────

DROP POLICY IF EXISTS "service_role_full_access" ON _system_entities;

CREATE POLICY "service_role_full_access" ON _system_entities FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
