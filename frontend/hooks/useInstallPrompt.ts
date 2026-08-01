'use client';

import { useCallback, useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

// Stato di installabilità PWA condiviso tra il banner flottante
// (InstallAppBanner) e qualunque altro punto dell'UI voglia offrire
// l'installazione (es. la card fissa nella tab Accesso di Comandi).
//
// 'beforeinstallprompt' lo emette il browser una sola volta per caricamento
// pagina: va catturato in una variabile di modulo appena il file viene
// importato, non nell'effect di ogni singolo hook. Con lo stato tenuto in
// useState locale (versione precedente), solo il PRIMO componente montato in
// quel momento riceveva l'evento — un consumer montato più tardi (es. la card
// in una tab non ancora selezionata, come Accesso) restava con
// canInstall=false per sempre anche se l'app era installabile, con il
// pulsante "Installa App" visibile ma sempre disabilitato.
let sharedDeferredPrompt: BeforeInstallPromptEvent | null = null;
const subscribers = new Set<() => void>();

const globalForInstallPrompt = globalThis as unknown as { __zeusxInstallPromptListenerAttached?: boolean };
if (typeof window !== 'undefined' && !globalForInstallPrompt.__zeusxInstallPromptListenerAttached) {
  globalForInstallPrompt.__zeusxInstallPromptListenerAttached = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    sharedDeferredPrompt = e as BeforeInstallPromptEvent;
    subscribers.forEach((notify) => notify());
  });
}

export function useInstallPrompt() {
  const [, forceRerender] = useState(0);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsStandalone(standalone);
    setIsIos(/iphone|ipad|ipod/i.test(window.navigator.userAgent));

    const notify = () => forceRerender((n) => n + 1);
    subscribers.add(notify);
    return () => {
      subscribers.delete(notify);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!sharedDeferredPrompt) return;
    await sharedDeferredPrompt.prompt();
    await sharedDeferredPrompt.userChoice;
    sharedDeferredPrompt = null;
    subscribers.forEach((notify) => notify());
  }, []);

  return { canInstall: !!sharedDeferredPrompt, isIos, isStandalone, promptInstall };
}
