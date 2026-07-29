'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { AlertTriangle, XCircle, CreditCard, Clock } from 'lucide-react';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

interface AppInfo {
  id: string;
  name: string;
  status: 'trial' | 'active' | 'expired' | 'past_due' | 'canceled';
  trial_end: string | null;
  trial_ends_at: string | null;
  totalum_app_id: string | null;
}

interface SubscriptionAlertProps {
  appId: string;
  appName?: string;
}

export default function SubscriptionAlert({ appId, appName }: SubscriptionAlertProps) {
  const router = useRouter();
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [daysRemaining, setDaysRemaining] = useState(0);

  useEffect(() => {
    checkSubscriptionStatus();
  }, [appId]);

  const checkSubscriptionStatus = async () => {
    try {
      const { data: app, error } = await supabase
        .from('apps')
        .select('id, name, status, trial_end, trial_ends_at, totalum_app_id')
        .eq('id', appId)
        .single();

      if (error || !app) {
        console.error('Errore recupero info app:', error);
        setLoading(false);
        return;
      }

      setAppInfo(app);

      // Calcola giorni rimanenti
      const trialEnd = app.trial_end || app.trial_ends_at;
      if (trialEnd) {
        const trialDate = new Date(trialEnd);
        const now = new Date();
        const diffTime = trialDate.getTime() - now.getTime();
        const days = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
        setDaysRemaining(days);
      }
    } catch (err) {
      console.error('Errore controllo abbonamento:', err);
    } finally {
      setLoading(false);
    }
  };

  const getCheckoutUrl = (): string => {
    if (!appInfo?.totalum_app_id) return '#';
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
    return `${appUrl}/api/totalum-client/checkout?totalum_app_id=${appInfo.totalum_app_id}`;
  };

  const handleSubscribe = () => {
    // Reindirizza alla pagina settings per attivare l'abbonamento
    const slug = window.location.pathname.split('/')[2];
    router.push(`/a/${slug}/settings`);
  };

  // Se in loading o app non trovata, non mostra nulla
  if (loading || !appInfo) return null;

  // Se l'app è attiva, non mostra nessun avviso
  if (appInfo.status === 'active') return null;

  // Se il trial è scaduto (giorni rimanenti <= 0)
  // Mostra MODAL BLOCCANTE a schermo intero
  if (daysRemaining <= 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950">
        <div className="max-w-md w-full mx-4">
          <div className="bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-8 text-center">
            {/* Icona */}
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <XCircle className="w-8 h-8 text-red-400" />
            </div>

            {/* Titolo */}
            <h1 className="text-2xl font-bold text-white mb-4">
              Periodo di prova scaduto
            </h1>

            {/* Messaggio */}
            <p className="text-gray-400 mb-2">
              Il periodo di prova di 30 giorni per <span className="text-white font-semibold">"{appName || appInfo.name}"</span> è terminato.
            </p>

            <p className="text-gray-300 text-sm mb-8">
              Per continuare ad utilizzare l'applicazione, attiva subito l'abbonamento.
            </p>

            {/* Pulsante abbonamento */}
            <button
              onClick={handleSubscribe}
              className="w-full bg-violet-600 hover:bg-violet-500 text-white py-3 px-6 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <CreditCard className="w-5 h-5" />
              Attiva Abbonamento
            </button>

            {/* Prezzo */}
            <p className="text-xs text-gray-500 mt-4">
              Il servizio ha un costo mensile che verrà definito al momento dell'abbonamento
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Se il trial è attivo e mancano meno di 7 giorni
  // Mostra BANNER NON BLOCCANTE in alto
  if (appInfo.status === 'trial' && daysRemaining > 0 && daysRemaining <= 7) {
    return (
      <div className="fixed top-0 left-0 right-0 z-40 bg-gradient-to-r from-yellow-600/90 to-orange-600/90 backdrop-blur-sm border-b border-yellow-500/30">
        <div className="px-4 py-3 flex items-center justify-center gap-3">
          <Clock className="w-5 h-5 text-yellow-200" />
          <span className="text-yellow-100 text-sm font-medium">
            Il tuo periodo di prova gratuito scade tra <span className="font-bold">{daysRemaining}</span> {daysRemaining === 1 ? 'giorno' : 'giorni'}.
          </span>
          <button
            onClick={handleSubscribe}
            className="ml-2 text-yellow-200 underline text-sm font-semibold hover:text-white transition-colors"
          >
            Attiva abbonamento ora
          </button>
        </div>
      </div>
    );
  }

  // Nessun avviso da mostrare
  return null;
}