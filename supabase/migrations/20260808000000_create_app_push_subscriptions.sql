-- ============================================================================
-- ZeusX - Web Push Notifications native per le PWA generate (Fase B)
-- Data: 2026-08-08
-- Descrizione: tabella per le subscription push (PushSubscription del
-- browser: endpoint + chiavi p256dh/auth) raccolte dai visitatori anonimi
-- della PWA pubblica (/a/[slug]). Nessuna colonna tenant_id/user_id: chi si
-- iscrive è un cliente finale anonimo, non un account ZeusX o app_users.
-- Isolamento multi-tenant garantito solo da app_id (FK verso apps).
--
-- Accesso: NESSUNA policy permissiva per anon/authenticated, stesso schema
-- già adottato per `subscriptions` dopo l'audit pre-lancio (vedi
-- 20260723000002_lockdown_apps_credentials_and_subscriptions.sql) — ogni
-- lettura/scrittura passa dalle API route Next.js con la service_role key
-- dopo i controlli applicativi (subscribe-push è pubblica ma valida
-- l'esistenza dell'app; send-push verifica che il chiamante sia membro del
-- tenant proprietario).
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  subscription jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_push_subscriptions_app_id_idx ON app_push_subscriptions(app_id);

-- Evita righe duplicate quando lo stesso browser richiama subscribe-push più
-- volte (reload della pagina, click ripetuto sul banner): un invio broadcast
-- non deve mandare la stessa notifica due volte allo stesso dispositivo.
CREATE UNIQUE INDEX IF NOT EXISTS app_push_subscriptions_app_endpoint_idx
  ON app_push_subscriptions(app_id, (subscription->>'endpoint'));

ALTER TABLE app_push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_push_subscriptions_deny_anon_authenticated" ON app_push_subscriptions;
CREATE POLICY "app_push_subscriptions_deny_anon_authenticated" ON app_push_subscriptions FOR ALL
  USING (false)
  WITH CHECK (false);

-- ============================================================================
-- FINE MIGRAZIONE
-- ============================================================================
