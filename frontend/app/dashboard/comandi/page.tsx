'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Loader2 } from 'lucide-react';
import { supabaseBrowser } from '@/src/lib/supabase-browser';
import { useLanguage } from '@/src/lib/LanguageContext';
import { provisionComandiAppAction } from '@/app/actions/comandi-provisioning';

// Punto d'ingresso storico (voce sidebar ZeusX "Comandi AI") e rete di
// sicurezza per /comandi in caso di errore di provisioning: risolve o
// provisiona l'istanza Comandi del tenant dell'utente e reindirizza subito a
// /a/{slug}, dove vivono ormai landing, login, cassa e dashboard dedicati
// (questa pagina non mostra più la cassa direttamente).
export default function ComandiRedirectPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const {
        data: { session },
      } = await supabaseBrowser.auth.getSession();

      if (cancelled) return;

      if (!session?.access_token) {
        router.push('/login');
        return;
      }

      const result = await provisionComandiAppAction({ accessToken: session.access_token });

      if (cancelled) return;

      if (!result.success || !result.slug) {
        setError(result.error || t('comandi_error_network'));
        return;
      }

      router.push(`/a/${result.slug}`);
    })();

    return () => {
      cancelled = true;
    };
  }, [router, t]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 p-8">
      {error ? (
        <div className="max-w-md flex items-start gap-2 rounded-lg border border-red-700/50 bg-red-900/20 p-4 text-sm text-red-300">
          <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : (
        <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
      )}
    </div>
  );
}
