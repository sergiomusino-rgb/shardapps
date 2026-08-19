'use client';

// ─── NotificationPreferencesSection (Notifications, Round 2) ───────────────
// Unico interruttore reale mancante prima di questa scheda: le email
// automatiche (notifiche di workflow, avvisi di scadenza/blocco abbonamento)
// venivano sempre inviate, senza modo di disattivarle per questa app. Legge/
// scrive apps.notification_preferences (migration 20260828000000) tramite la
// stessa route PATCH /api/apps/[id] già usata dal resto di questa pagina per
// il profilo cliente — nessuna nuova route.
//
// Nessun interruttore push qui: le notifiche push hanno già un opt-in/opt-out
// reale e per-visitatore (banner di iscrizione in components/
// PushNotificationBanner.tsx, gestito da app_push_subscriptions) — un
// secondo interruttore "push abilitato per l'app" non controllerebbe nulla
// che l'owner non controlli già inviando o meno una notifica (vedi
// PushNotificationSection.tsx, immediatamente sopra questa scheda).

import { useEffect, useState } from 'react';
import { Mail, Loader2 } from 'lucide-react';
import { supabase } from '@/src/lib/supabase';

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

export default function NotificationPreferencesSection({ appId }: { appId: string }) {
  const [emailEnabled, setEmailEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!appId) return;
    (async () => {
      const { data, error: fetchError } = await supabase
        .from('apps')
        .select('notification_preferences')
        .eq('id', appId)
        .single();
      if (fetchError) {
        setLoadError('Impossibile caricare le preferenze di notifica.');
        return;
      }
      const prefs = (data as { notification_preferences?: { email?: boolean } } | null)?.notification_preferences;
      // Fail-open: assente/malformato -> email attiva (default), stesso
      // comportamento già applicato lato backend in action-dispatcher.js.
      setEmailEnabled(prefs && typeof prefs === 'object' && prefs.email === false ? false : true);
    })();
  }, [appId]);

  async function handleToggle() {
    if (emailEnabled === null || saving) return;
    const next = !emailEnabled;
    setSaving(true);
    setError('');
    const previous = emailEnabled;
    setEmailEnabled(next); // ottimistico, con rollback su errore

    try {
      const res = await fetch(`/api/apps/${appId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ notificationPreferences: { email: next } }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Errore salvataggio preferenza');
        setEmailEnabled(previous);
      }
    } catch {
      setError('Errore di connessione');
      setEmailEnabled(previous);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-6 mb-6">
      <h2 className="text-xl font-bold flex items-center gap-2 mb-4">
        <Mail className="w-5 h-5 text-violet-400" />
        Notifiche Email
      </h2>

      {loadError ? (
        <p className="text-sm text-red-400">{loadError}</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-white font-medium">Invio automatico email</p>
              <p className="text-xs text-gray-500 mt-1 max-w-md">
                Notifiche di workflow e avvisi di scadenza/blocco abbonamento. Le email di sicurezza
                (reset password, comunicazioni amministrative) vengono sempre inviate indipendentemente da questa scelta.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={emailEnabled === true}
              disabled={emailEnabled === null || saving}
              onClick={handleToggle}
              className={`relative shrink-0 w-12 h-7 rounded-full transition-colors disabled:opacity-50 ${
                emailEnabled ? 'bg-violet-600' : 'bg-slate-700'
              }`}
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin text-white absolute top-1.5 left-1.5" />
              ) : (
                <span
                  className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${
                    emailEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              )}
            </button>
          </div>
          {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
        </>
      )}
    </div>
  );
}
