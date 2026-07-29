'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { CreditCard, XCircle, CheckCircle, Loader2, ExternalLink } from 'lucide-react';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

type AppStatus = 'trial' | 'active' | 'expired' | 'past_due' | 'canceled';

interface AppInfo {
  id: string;
  name: string;
  status: AppStatus;
  trial_end: string | null;
  trial_ends_at: string | null;
  client_price: number;
  stripe_subscription_id: string | null;
}

export default function SubscriptionPage() {
  const router = useRouter();
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [user, setUser] = useState<any>(null);

  // Mock app ID - in a real app this would come from context/params
  const appId = process.env.NEXT_PUBLIC_APP_ID || 'mock-app-id';

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/');
        return;
      }
      setUser(user);

      // Get app info
      const { data: app } = await supabase
        .from('apps')
        .select('id, name, status, trial_end, trial_ends_at, client_price, stripe_subscription_id')
        .eq('id', appId)
        .single();
      
      setAppInfo(app);
      setLoading(false);
    };
    init();
  }, [appId, router]);

  const handleSubscribe = async () => {
    setActionLoading(true);
    try {
      const response = await fetch('/api/apps/checkout', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        },
        body: JSON.stringify({ 
          appId,
          clientEmail: user.email 
        }),
      });
      
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || data.message || 'Errore durante la creazione della sessione di checkout');
      }
    } catch (err) {
      alert('Errore di connessione');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelSubscription = async () => {
    if (!confirm('Sei sicuro di voler disdire l\'abbonamento? L\'app continuerà a funzionare fino alla fine del periodo di pagamento corrente.')) {
      return;
    }
    
    setActionLoading(true);
    try {
      const response = await fetch(`/api/a/${appId}/cancel-subscription`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        },
      });
      
      const data = await response.json();
      if (data.success) {
        alert('Abbonamento disdetto con successo. L\'accesso rimarrà attivo fino alla fine del periodo corrente.');
        setAppInfo(prev => prev ? { ...prev, status: 'active' } : null);
      } else {
        alert(data.error || 'Errore durante la disdetta');
      }
    } catch (err) {
      alert('Errore di connessione');
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusLabel = (status: AppStatus): string => {
    switch (status) {
      case 'trial':
        return 'In Prova';
      case 'active':
        return 'Attivo';
      case 'expired':
        return 'Scaduto';
      case 'past_due':
        return 'Pagamento in Ritardo';
      case 'canceled':
        return 'Cancellato';
      default:
        return status;
    }
  };

  const getStatusColor = (status: AppStatus): string => {
    switch (status) {
      case 'trial':
        return 'bg-violet-500/20 text-violet-400';
      case 'active':
        return 'bg-green-500/20 text-green-400';
      case 'expired':
        return 'bg-red-500/20 text-red-400';
      case 'past_due':
        return 'bg-yellow-500/20 text-yellow-400';
      case 'canceled':
        return 'bg-gray-500/20 text-gray-400';
      default:
        return 'bg-gray-500/20 text-gray-400';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
      </div>
    );
  }

  if (!appInfo) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <p className="text-gray-400">App non trovata</p>
      </div>
    );
  }

  const isActive = appInfo.status === 'active';
  const isTrial = appInfo.status === 'trial';
  const isExpired = appInfo.status === 'expired' || appInfo.status === 'past_due' || appInfo.status === 'canceled';

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Gestione Abbonamento</h1>
          <p className="text-gray-400">Gestisci il tuo abbonamento per {appInfo.name}</p>
        </div>

        {/* Status Card */}
        <div className="bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <span className="text-gray-400">Stato abbonamento</span>
            <span className={`px-3 py-1 rounded-lg text-sm font-medium ${getStatusColor(appInfo.status)}`}>
              {getStatusLabel(appInfo.status)}
            </span>
          </div>
          
          {isTrial && appInfo.trial_ends_at && (
            <div className="text-sm text-gray-400">
              Periodo di prova termina il: {new Date(appInfo.trial_ends_at).toLocaleDateString('it-IT')}
            </div>
          )}

          {isActive && (
            <div className="text-sm text-green-400">
              Il tuo abbonamento è attivo e rinnoverà automaticamente
            </div>
          )}
        </div>

        {/* Pricing Card */}
        <div className="bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">Prezzo Abbonamento</h2>
          
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-4xl font-bold text-white">
              €{appInfo.client_price.toFixed(2)}
            </span>
            <span className="text-gray-400">/mese</span>
          </div>

          <p className="text-sm text-gray-400">
            Prezzo mensile definito dal fornitore del servizio
          </p>
        </div>

        {/* Subscription Management */}
        <div className="bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">Gestione Abbonamento</h2>
          
          {!isActive ? (
            <button
              onClick={handleSubscribe}
              disabled={actionLoading}
              className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-gray-600 text-white py-3 px-6 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
            >
              {actionLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <CreditCard className="w-5 h-5" />
              )}
              {isExpired ? 'Rinnova Abbonamento' : isTrial ? 'Attiva Abbonamento' : 'Abbonati Ora'}
            </button>
          ) : (
            <div>
              <button
                onClick={handleCancelSubscription}
                disabled={actionLoading}
                className="w-full border border-red-500/30 text-red-400 hover:bg-red-950/20 disabled:opacity-50 text-white py-3 px-6 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {actionLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <XCircle className="w-5 h-5" />
                )}
                Disdici Abbonamento
              </button>
              <p className="text-xs text-gray-500 mt-3 text-center">
                La disdetta interrompe il rinnovo automatico. L'accesso rimarrà attivo fino alla fine del periodo corrente.
              </p>
            </div>
          )}
        </div>

        {/* Legal Information - Mandatory */}
        <div className="bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">Informazioni Legali</h2>
          
          <div className="space-y-4 text-sm text-gray-400">
            {/* Terms of Service */}
            <div className="flex items-start gap-3">
              <ExternalLink className="w-4 h-4 mt-0.5 text-violet-400 flex-shrink-0" />
              <div>
                <h3 className="text-white font-medium mb-1">Termini di Servizio</h3>
                <p className="mb-2">
                  Consulta i termini e le condizioni per l'utilizzo di questo servizio.
                </p>
                <a 
                  href="/legal/terms" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-violet-400 hover:text-violet-300 underline"
                >
                  Visualizza Termini di Servizio
                </a>
              </div>
            </div>

            {/* Privacy Policy */}
            <div className="flex items-start gap-3">
              <ExternalLink className="w-4 h-4 mt-0.5 text-violet-400 flex-shrink-0" />
              <div>
                <h3 className="text-white font-medium mb-1">Privacy Policy</h3>
                <p className="mb-2">
                  Informazioni su come raccogliamo, utilizziamo e proteggiamo i tuoi dati personali.
                </p>
                <a 
                  href="/legal/privacy" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-violet-400 hover:text-violet-300 underline"
                >
                  Visualizza Privacy Policy
                </a>
              </div>
            </div>

            {/* Right of Withdrawal Disclaimer */}
            <div className="flex items-start gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <div className="flex-1">
                <h3 className="text-yellow-400 font-medium mb-2 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  Diritto di Recesso
                </h3>
                <p className="text-xs text-gray-300 leading-relaxed">
                  <strong>Attenzione:</strong> Ai sensi dell'articolo 59, comma 1, lettera o) del Codice del Consumo (D.Lgs. 206/2005), 
                  il diritto di recesso non si applica ai contratti per la fornitura di contenuto digitale mediante supporto non materiale 
                  (come software, applicazioni, servizi cloud) se l'esecuzione è iniziata con l'accordo espresso del consumatore 
                  e con la sua accettazione della perdita del diritto di recesso. Utilizzando questo servizio, confermi di accettare 
                  che l'erogazione del servizio inizi immediatamente e rinunci al diritto di recesso.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Additional Information */}
        <div className="bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-6">
          <h2 className="text-xl font-bold mb-4">Informazioni Aggiuntive</h2>
          
          <div className="space-y-3 text-sm text-gray-400">
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 mt-0.5 text-green-400 flex-shrink-0" />
              <p>
                L'abbonamento si rinnova automaticamente ogni mese alla data di attivazione.
              </p>
            </div>
            
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 mt-0.5 text-green-400 flex-shrink-0" />
              <p>
                Puoi disdire l'abbonamento in qualsiasi momento. L'accesso rimarrà attivo fino alla fine del periodo pagato.
              </p>
            </div>
            
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 mt-0.5 text-green-400 flex-shrink-0" />
              <p>
                Il pagamento viene elaborato automaticamente tramite carta di credito o debito.
              </p>
            </div>

            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 mt-0.5 text-blue-400 flex-shrink-0" />
              <p>
                Per assistenza o domande, contatta il supporto all'indirizzo: support@zeusx.it
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}