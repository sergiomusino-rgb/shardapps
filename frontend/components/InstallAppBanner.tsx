'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, Share, SquarePlus, X } from 'lucide-react';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';

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
  const { canInstall, isIos, isIosNonSafari, isStandalone, promptInstall } = useInstallPrompt();
  // true finché non verifichiamo localStorage (al mount), per non far
  // lampeggiare il banner un istante prima di scoprire che era già chiuso.
  const [dismissed, setDismissed] = useState(true);
  const [showIosAfterDelay, setShowIosAfterDelay] = useState(false);
  const storageKey = `zeusx_install_dismissed_${slug}`;

  useEffect(() => {
    setDismissed(localStorage.getItem(storageKey) === '1');
  }, [storageKey]);

  // iOS non emette beforeinstallprompt: mostriamo comunque il banner con le
  // istruzioni manuali dopo una breve pausa (non subito, per non essere invasivi).
  useEffect(() => {
    if (!isIos) return;
    const timer = setTimeout(() => setShowIosAfterDelay(true), 2000);
    return () => clearTimeout(timer);
  }, [isIos]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    localStorage.setItem(storageKey, '1');
  }, [storageKey]);

  const handleInstall = useCallback(async () => {
    await promptInstall();
    dismiss();
  }, [promptInstall, dismiss]);

  const visible = !isStandalone && !dismissed && (canInstall || (isIos && showIosAfterDelay));
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
        {isIosNonSafari ? (
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: textColor, opacity: 0.75 }}>
            Apri questo indirizzo in <strong>Safari</strong> per installare l&apos;app: da questo browser l&apos;installazione non è disponibile su iPhone/iPad.
          </p>
        ) : isIos ? (
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
