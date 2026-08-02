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
  // Su iOS l'installazione come vera PWA standalone (icona Home che apre
  // l'app senza barra degli indirizzi) è possibile SOLO da Safari: Apple non
  // la espone agli altri browser (Chrome/CriOS, Firefox/FxiOS, Edge/EdgiOS,
  // app Google/GSA, ecc.), che pure girano sullo stesso motore WebKit. Da
  // questi browser "Aggiungi alla schermata Home" crea solo un segnalibro
  // che riapre il browser stesso, non un'app installata — da qui il caso
  // "non si installa" quando l'utente sta usando Chrome o l'app Google.
  const [isIosNonSafari, setIsIosNonSafari] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsStandalone(standalone);
    const ua = window.navigator.userAgent;
    const onIos = /iphone|ipad|ipod/i.test(ua);
    setIsIos(onIos);
    // Token identificativi che i browser non-Safari su iOS devono includere
    // nello user agent (imposto da Apple/dai rispettivi vendor), dato che
    // tutti includono comunque "Safari/..." come token di compatibilità.
    setIsIosNonSafari(onIos && /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|mercury|GSA\//i.test(ua));

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

  return { canInstall: !!sharedDeferredPrompt, isIos, isIosNonSafari, isStandalone, promptInstall };
}
