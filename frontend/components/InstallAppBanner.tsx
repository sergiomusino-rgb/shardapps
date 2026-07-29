'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, Share, SquarePlus, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface InstallAppBannerProps {
  appName: string;
  slug: string;
  primaryColor: string;
  textColor: string;
  surfaceColor: string;
  borderColor: string;
}

// Banner discreto "Installa App" per la landing pubblica: intercetta
// beforeinstallprompt su Chrome/Edge/Android, mostra le istruzioni manuali su
// iOS Safari (che non espone quell'evento), e resta nascosto se l'app e' gia'
// installata (display-mode: standalone) o se l'utente l'ha gia' chiuso.
export default function InstallAppBanner({
  appName,
  slug,
  primaryColor,
  textColor,
  surfaceColor,
  borderColor,
}: InstallAppBannerProps) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const storageKey = `zeusx_install_dismissed_${slug}`;

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (isStandalone) return;
    if (localStorage.getItem(storageKey) === '1') return;

    const iosDevice = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    setIsIos(iosDevice);

    const handlePrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', handlePrompt);

    // iOS non emette beforeinstallprompt: mostriamo comunque il banner con
    // le istruzioni manuali dopo una breve pausa (non subito, per non essere invasivi).
    let iosTimer: ReturnType<typeof setTimeout> | undefined;
    if (iosDevice) {
      iosTimer = setTimeout(() => setVisible(true), 2000);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handlePrompt);
      if (iosTimer) clearTimeout(iosTimer);
    };
  }, [storageKey]);

  const dismiss = useCallback(() => {
    setVisible(false);
    localStorage.setItem(storageKey, '1');
  }, [storageKey]);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setVisible(false);
    localStorage.setItem(storageKey, '1');
  }, [deferredPrompt, storageKey]);

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Installa app"
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
        <Download size={20} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: textColor }}>
          Installa {appName} sul tuo smartphone
        </p>
        {isIos ? (
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: textColor, opacity: 0.75, display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
            Tocca <Share size={13} style={{ display: 'inline' }} /> Condividi, poi <SquarePlus size={13} style={{ display: 'inline' }} /> &quot;Aggiungi a Home&quot;
          </p>
        ) : (
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: textColor, opacity: 0.75 }}>
            Accesso rapido, come un&apos;app vera, direttamente dalla Home.
          </p>
        )}

        {!isIos && (
          <button
            type="button"
            onClick={handleInstall}
            style={{
              marginTop: '10px', padding: '8px 16px', borderRadius: '8px', border: 'none',
              background: primaryColor, color: '#fff', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
            }}
          >
            Installa App
          </button>
        )}
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
