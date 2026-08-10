'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CreditCard, XCircle, CheckCircle, Loader2, Mail, Lock, Eye, EyeOff, QrCode } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '@/src/lib/supabase';
import ZeusXBrandingFooter from '@/components/ZeusXBrandingFooter';
import CollectedDataSection from './CollectedDataSection';
import PushNotificationSection from './PushNotificationSection';

interface AppInfo {
  id: string;
  name: string;
  status: string | null;
  trial_ends_at: string | null;
  stripe_subscription_id: string | null;
  client_email?: string | null;
  config?: { schema?: { tables?: any[] } } | null;
}

export default function SettingsPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [, setUser] = useState<any>(null);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push(`/a/${slug}`);
        return;
      }
      setUser(user);

      // Get app info
      const { data: app } = await supabase
        .from('apps')
        .select('id, name, status, trial_ends_at, stripe_subscription_id, client_email, config')
        .eq('slug', slug)
        .single();
      
      setAppInfo(app as unknown as AppInfo | null);
      setLoading(false);
    };
    init();
  }, [slug, router]);

  const handleSubscribe = async () => {
    setActionLoading(true);
    try {
      const response = await fetch(`/api/a/${slug}/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Errore durante la creazione della sessione di checkout');
      }
    } catch {
      alert('Errore di connessione');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelSubscription = async () => {
    if (!confirm('Sei sicuro di voler disdire l\'abbonamento? L\'app continuerà a funzionare fin al prossimo rinnovo.')) {
      return;
    }
    
    setActionLoading(true);
    try {
      // La route ora richiede autenticazione (fix cross-tenant, vedi
      // cancel-subscription/route.ts): senza il token la chiamata torna 401
      // anche per il proprietario legittimo.
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`/api/a/${slug}/cancel-subscription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });

      const data = await response.json();
      if (data.success) {
        alert('Abbonamento disdetto con successo');
        setAppInfo(prev => prev ? { ...prev, status: 'active' } : null);
      } else {
        alert(data.error || 'Errore durante la disdetta');
      }
    } catch {
      alert('Errore di connessione');
    } finally {
      setActionLoading(false);
    }
  };

  // Credenziali form
  const [showCredentialsForm, setShowCredentialsForm] = useState(false);
  const [clientEmail, setClientEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [credentialsLoading, setCredentialsLoading] = useState(false);
  const [credentialsMessage, setCredentialsMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleUpdateCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setCredentialsLoading(true);
    setCredentialsMessage(null);

    try {
      // Validazioni
      if (!clientEmail || !clientEmail.includes('@')) {
        setCredentialsMessage({ type: 'error', text: 'Inserisci un\'email valida' });
        setCredentialsLoading(false);
        return;
      }

      if (newPassword && newPassword.length < 8) {
        setCredentialsMessage({ type: 'error', text: 'La password deve essere di almeno 8 caratteri' });
        setCredentialsLoading(false);
        return;
      }

      if (newPassword && newPassword !== confirmPassword) {
        setCredentialsMessage({ type: 'error', text: 'Le password non corrispondono' });
        setCredentialsLoading(false);
        return;
      }

      if (newPassword && !currentPassword) {
        setCredentialsMessage({ type: 'error', text: 'Inserisci la password attuale per confermare' });
        setCredentialsLoading(false);
        return;
      }

      const updateData: any = {
        client_email: clientEmail,
      };

      if (newPassword) {
        updateData.client_password = newPassword;
      }

      const response = await fetch(`/api/a/${slug}/update-credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      });

      const data = await response.json();

      if (data.success) {
        setCredentialsMessage({ type: 'success', text: 'Credenziali aggiornate con successo!' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setShowPasswords(false);
      } else {
        setCredentialsMessage({ type: 'error', text: data.error || 'Errore durante l\'aggiornamento' });
      }
    } catch {
      setCredentialsMessage({ type: 'error', text: 'Errore di connessione' });
    } finally {
      setCredentialsLoading(false);
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

  const isTrial = appInfo.status === 'trial';
  const isActive = appInfo.status === 'active';
  const isExpired = appInfo.status === 'expired';

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Impostazioni</h1>
          <p className="text-gray-400">Gestisci il tuo abbonamento per {appInfo.name}</p>
        </div>

        {/* Status Card */}
        <div className="bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <span className="text-gray-400">Stato abbonamento</span>
            <span className={`px-3 py-1 rounded-lg text-sm font-medium ${
              isActive ? 'bg-green-500/20 text-green-400' :
              isTrial ? 'bg-violet-500/20 text-violet-400' :
              'bg-red-500/20 text-red-400'
            }`}>
              {isActive ? 'Attivo' : isTrial ? 'Prova' : 'Scaduto'}
            </span>
          </div>
          
          {isTrial && appInfo.trial_ends_at && (
            <div className="text-sm text-gray-400">
              Periodo di prova termina il: {new Date(appInfo.trial_ends_at).toLocaleDateString('it-IT')}
            </div>
          )}
        </div>

        {/* Subscription Management */}
        <div className="bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">Gestione Abbonamento</h2>
          
          {isTrial || isExpired ? (
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
              {isExpired ? 'Rinnova Abbonamento' : 'Attiva Abbonamento'}
            </button>
          ) : (
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
          )}
        </div>

        {/* Credenziali di Accesso */}
        <div className="bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Sicurezza</h2>
            <button
              onClick={() => setShowCredentialsForm(!showCredentialsForm)}
              className="text-violet-400 hover:text-violet-300 text-sm font-medium"
            >
              {showCredentialsForm ? 'Nascondi' : 'Modifica Credenziali'}
            </button>
          </div>

          {appInfo.client_email && (
            <div className="mb-4 p-4 bg-slate-800/50 rounded-lg">
              <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
                <Mail size={16} />
                <span>Email di accesso attuale:</span>
              </div>
              <p className="text-white font-mono text-sm">{appInfo.client_email}</p>
            </div>
          )}

          {showCredentialsForm && (
            <form onSubmit={handleUpdateCredentials} className="space-y-4">
              <div>
                <label className="block text-gray-400 text-sm mb-2">Nuova Email di Accesso</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                  <input
                    type="email"
                    value={clientEmail}
                    onChange={(e) => setClientEmail(e.target.value)}
                    placeholder="email@esempio.com"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg py-3 pl-10 pr-4 text-white placeholder-gray-500 focus:outline-none focus:border-violet-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-gray-400 text-sm mb-2">Password Attuale</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                  <input
                    type={showPasswords ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg py-3 pl-10 pr-12 text-white placeholder-gray-500 focus:outline-none focus:border-violet-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswords(!showPasswords)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-400"
                  >
                    {showPasswords ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-gray-400 text-sm mb-2">Nuova Password (opzionale)</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                  <input
                    type={showPasswords ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimo 8 caratteri"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg py-3 pl-10 pr-4 text-white placeholder-gray-500 focus:outline-none focus:border-violet-500"
                    minLength={8}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">Lascia vuoto per mantenere la password attuale</p>
              </div>

              {newPassword && (
                <div>
                  <label className="block text-gray-400 text-sm mb-2">Conferma Nuova Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                    <input
                      type={showPasswords ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Ripeti la nuova password"
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg py-3 pl-10 pr-4 text-white placeholder-gray-500 focus:outline-none focus:border-violet-500"
                    />
                  </div>
                </div>
              )}

              {credentialsMessage && (
                <div className={`p-4 rounded-lg flex items-start gap-3 ${
                  credentialsMessage.type === 'success' 
                    ? 'bg-green-500/10 border border-green-500/30' 
                    : 'bg-red-500/10 border border-red-500/30'
                }`}>
                  {credentialsMessage.type === 'success' ? (
                    <CheckCircle className="text-green-400 mt-0.5" size={18} />
                  ) : (
                    <XCircle className="text-red-400 mt-0.5" size={18} />
                  )}
                  <p className={`text-sm ${credentialsMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                    {credentialsMessage.text}
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={credentialsLoading}
                className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-gray-600 text-white py-3 px-6 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {credentialsLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Aggiornamento...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-5 h-5" />
                    Salva Credenziali
                  </>
                )}
              </button>
            </form>
          )}
        </div>

        {/* Dati Raccolti: tabelle di dominio generate dall'app (es. Lead, Ordini,
            Prenotazioni) escluse le tabelle di sistema sempre presenti
            (dati_aziendali, fatture — vedi ensureCoreSystemTables in
            blueprint-schema.ts), non pertinenti qui. */}
        <CollectedDataSection
          appId={appInfo.id}
          tables={(appInfo.config?.schema?.tables || []).filter(
            (t) => t?.name !== 'dati_aziendali' && t?.name !== 'fatture'
          )}
        />

        <PushNotificationSection appId={appInfo.id} />

        {/* QR Code per accesso mobile */}
        <div className="bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <QrCode className="w-5 h-5 text-violet-400" />
              Accesso Rapido
            </h2>
          </div>
          
          <div className="flex flex-col items-center">
            <div className="bg-white p-4 rounded-xl mb-3">
              <QRCodeSVG 
                value={`${process.env.NEXT_PUBLIC_APP_URL || 'https://zeusxapps.com'}/a/${slug}`}
                size={120}
                bgColor="#ffffff"
                fgColor="#000000"
                level="M"
              />
            </div>
            <p className="text-gray-400 text-sm text-center">
              Scansiona per aprire l&apos;app su smartphone
            </p>
          </div>
        </div>
      </div>
      
      <ZeusXBrandingFooter />
    </div>
  );
}
