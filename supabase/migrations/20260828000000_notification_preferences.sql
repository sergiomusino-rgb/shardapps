-- ─── Notification preferences (Pre-Beta Hardening Round 2 — Notifications) ─
-- Prima di questa migration non esisteva alcun modo di disattivare le email
-- automatiche di un'app (notifiche workflow, avvisi di scadenza abbonamento):
-- ogni evento le inviava sempre, incondizionatamente. Aggiunge una singola
-- colonna JSONB per-app, deliberatamente minima (email ora, push non incluso
-- qui perché le notifiche push hanno già un meccanismo di opt-in/opt-out
-- reale e per-visitatore — l'iscrizione/disiscrizione del browser in
-- app_push_subscriptions, vedi frontend/components/PushNotificationBanner.tsx
-- — un secondo interruttore a livello app sarebbe ridondante, non una scelta
-- utile in più).
--
-- Le email SEMPRE inviate indipendentemente da questa preferenza (mai
-- disattivabili, per motivi di sicurezza/operatività, non di marketing):
-- password_reset (l'utente l'ha esplicitamente richiesta pochi secondi
-- prima) e admin_alert (comunicazione amministrativa su un'azione presa
-- sull'account, es. presa in gestione diretta). Rispettano la preferenza:
-- workflow_notification (backend/lib/action-dispatcher.js) e billing
-- (backend/jobs/expiry-check.js).
--
-- Default {"email": true}: comportamento INVARIATO per ogni app esistente
-- finché il proprietario non la disattiva esplicitamente dalle Impostazioni.

alter table public.apps
  add column if not exists notification_preferences jsonb not null default '{"email": true}'::jsonb;

comment on column public.apps.notification_preferences is
  'Preferenze di notifica per-app (Pre-Beta Hardening Round 2). Solo {"email": boolean} oggi: quando email=false, le notifiche di workflow (send_notification) e gli avvisi di scadenza/blocco abbonamento non vengono inviati (restano comunque registrati in app_action_logs/log applicativi). password_reset e admin_alert non sono mai disattivabili da questo flag. Nessuna preferenza push qui: le notifiche push usano già un opt-in/opt-out reale per-visitatore (app_push_subscriptions).';
