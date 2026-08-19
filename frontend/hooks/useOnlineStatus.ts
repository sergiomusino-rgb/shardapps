'use client';

import { useEffect, useState } from 'react';

// ─── Online/offline detection (PWA hardening, Round 2) ─────────────────────
// Punto unico per sapere se il browser ha connettività: prima ogni pagina che
// ne aveva bisogno (es. components/comandi/TouchWarehouseDashboard.tsx)
// duplicava lo stesso pattern (navigator.onLine + listener online/offline).
// navigator.onLine riflette solo lo stato dell'interfaccia di rete (true
// anche su un captive portal senza vera uscita internet): è un segnale
// "affidabile per il caso comune" — offline reale del dispositivo — non una
// prova di raggiungibilità del backend, che resta comunque verificata da
// ogni singola fetch (i suoi errori restano gestiti dove già lo sono).
//
// `justReconnected` resta true per RECONNECTED_FLASH_MS dopo un ritorno
// online: usato dalla UI per mostrare un feedback "Connessione ripristinata"
// transitorio invece di sparire lo stato offline senza alcun segnale.
const RECONNECTED_FLASH_MS = 3000;

export interface OnlineStatus {
  isOnline: boolean;
  justReconnected: boolean;
}

export function useOnlineStatus(): OnlineStatus {
  // Default true: sia in SSR (navigator non esiste) sia al primo render
  // client prima dell'effect — evita di mostrare per un istante un banner
  // "offline" errato ad ogni caricamento pagina mentre l'utente è online.
  const [isOnline, setIsOnline] = useState(true);
  const [justReconnected, setJustReconnected] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    setIsOnline(navigator.onLine);

    let flashTimer: ReturnType<typeof setTimeout> | undefined;

    const handleOnline = () => {
      setIsOnline(true);
      setJustReconnected(true);
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => setJustReconnected(false), RECONNECTED_FLASH_MS);
    };
    const handleOffline = () => {
      setIsOnline(false);
      setJustReconnected(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (flashTimer) clearTimeout(flashTimer);
    };
  }, []);

  return { isOnline, justReconnected };
}
