'use client';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { WifiOff, Wifi } from 'lucide-react';

// ─── Offline banner (PWA hardening, Round 2) ────────────────────────────────
// Stato di rete SEMPRE visibile quando non affidabile, invece di lasciare che
// l'utente scopra l'assenza di connessione solo da un errore generico su un
// pulsante premuto ("Errore di connessione"). Nessuna interazione bloccata
// da questo componente: è solo un indicatore, ogni pagina resta responsabile
// di impedire/segnalare le proprie operazioni mutative quando offline (dove
// già lo fa tramite i propri stati di errore esistenti).
export default function OfflineBanner() {
  const { isOnline, justReconnected } = useOnlineStatus();

  if (isOnline && !justReconnected) return null;

  if (!isOnline) {
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-2 bg-amber-500/95 px-3 py-2 text-xs font-semibold text-amber-950 sm:text-sm"
      >
        <WifiOff size={14} className="flex-shrink-0" />
        <span>Sei offline — puoi consultare le pagine già aperte, ma salvare o inviare dati richiede una connessione.</span>
      </div>
    );
  }

  // justReconnected: feedback transitorio, sparisce da solo (vedi useOnlineStatus).
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-emerald-500/95 px-3 py-2 text-xs font-semibold text-emerald-950 sm:text-sm"
    >
      <Wifi size={14} className="flex-shrink-0" />
      <span>Connessione ripristinata.</span>
    </div>
  );
}
