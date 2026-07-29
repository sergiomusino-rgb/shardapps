'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';

interface PushNotificationBannerProps {
  appId: string;
  appName: string;
  slug: string;
  primaryColor: string;
  textColor: string;
  surfaceColor: string;
  borderColor: string;
}

// Converte la VAPID public key (base64url) nel formato Uint8Array richiesto
// da PushManager.subscribe({ applicationServerKey }).
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// Banner discreto "Attiva notifiche" per la landing pubblica: stesso pattern
// di InstallAppBanner (dismiss persistito in localStorage, nascosto se il
// browser non supporta le push o se il permesso è già stato deciso in un modo
// o nell'altro — non ha senso richiederlo di nuovo se già negato o già concesso).
export default function PushNotificationBanner({
  appId,
  appName,
  slug,
  primaryColor,
  textColor,
  surfaceColor,
  borderColor,
}: PushNotificationBannerProps) {
  const [visible, setVisible] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const storageKey = `zeusx_push_dismissed_${slug}`;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return;
    if (Notification.permission !== 'default') return;
    if (localStorage.getItem(storageKey) === '1') return;

    // Mostrato solo a PWA già installata (standalone): evita di sovrapporsi a
    // InstallAppBanner, che occupa la stessa posizione fissa per chi non ha
    // ancora installato l'app, e ha più senso chiedere le notifiche dopo che
    // l'utente ha già scelto di installare l'app come "nativa".
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (!isStandalone) return;

    const timer = setTimeout(() => setVisible(true), 3000);
    return () => clearTimeout(timer);
  }, [storageKey]);

  const dismiss = useCallback(() => {
    setVisible(false);
    localStorage.setItem(storageKey, '1');
  }, [storageKey]);

  const handleActivate = useCallback(async () => {
    setSubscribing(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        dismiss();
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
      });

      const res = await fetch(`/api/apps/${appId}/subscribe-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Errore attivazione notifiche');
      }

      dismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore attivazione notifiche');
      setSubscribing(false);
    }
  }, [appId, dismiss]);

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Attiva notifiche"
      style={{
        position: 'fixed', left: '16px', right: '16px', bottom: '16px', zIndex: 50,
        maxWidth: '420px', margin: '0 auto',
        background: surfaceColor, border: `1px solid ${borderColor}`,
        borderRadius: '16px', padding: '16px', display: 'flex', alignItems: 'flex-start', gap: '12px',
        boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          width: '40px', height: '40px', borderRadius: '10px',
          background: `${primaryColor}1A`, color: primaryColor,
        }}
      >
        <Bell size={20} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: textColor }}>
          Ricevi notifiche da {appName}
        </p>
        <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: textColor, opacity: 0.75 }}>
          Aggiornamenti su ordini e prenotazioni, direttamente sul telefono.
        </p>
        {error && (
          <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: '#ef4444' }}>{error}</p>
        )}

        <button
          type="button"
          onClick={handleActivate}
          disabled={subscribing}
          style={{
            marginTop: '10px', padding: '8px 16px', borderRadius: '8px', border: 'none',
            background: primaryColor, color: '#fff', fontSize: '13px', fontWeight: 700,
            cursor: subscribing ? 'not-allowed' : 'pointer', opacity: subscribing ? 0.7 : 1,
          }}
        >
          {subscribing ? 'Attivazione...' : 'Attiva Notifiche'}
        </button>
      </div>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Chiudi"
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: '2px',
          color: textColor, opacity: 0.5, flexShrink: 0,
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
