'use client';

import { useEffect, useState, type ChangeEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/src/lib/supabase';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Check, Key, ExternalLink } from 'lucide-react';

interface App {
  id: string;
  name: string;
  config: any;
  trial_ends_at: string;
  is_active: boolean;
  created_at: string | null;
  blueprint_id: string | null;
  tenant_id: string;
  app_type?: string | null;
  slug?: string | null;
  client_password?: string | null;
  client_email?: string | null;
  client_active?: boolean;
  expires_at?: string | null;
  initial_password?: string | null;
  auth_mode?: string | null;
  client_full_name?: string | null;
  client_phone?: string | null;
  client_tax_id?: string | null;
  client_billing_address?: string | null;
  client_notes?: string | null;
}

export default function AppDetailPage() {
  const params = useParams();
  const router = useRouter();
  const idOrSlug = params.id as string;

  const [app, setApp] = useState<App | null>(null);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [extending, setExtending] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [buyerForm, setBuyerForm] = useState({
    client_full_name: '',
    client_phone: '',
    client_tax_id: '',
    client_billing_address: '',
    client_notes: '',
  });
  const [savingBuyer, setSavingBuyer] = useState(false);
  const [buyerSaved, setBuyerSaved] = useState(false);

  // Brandizza la tua app (white label piano Business): sostituisce logo+testo
  // ShardApps nel footer sidebar dell'app generata (vedi SidebarBrandFooter).
  const [tenantPlan, setTenantPlan] = useState<string | null | undefined>(undefined);
  const [brandingForm, setBrandingForm] = useState({ footer_logo_url: '', footer_label: '' });
  const [savingBranding, setSavingBranding] = useState(false);
  const [brandingSaved, setBrandingSaved] = useState(false);
  const [brandingError, setBrandingError] = useState('');

  function applyLoadedApp(loaded: App) {
    // Questa pagina è costruita per le app a schema generato (Creator AI):
    // "credenziali" qui sono client_email/client_password dell'app stessa,
    // per Comandi AI invece quei campi appartengono all'account cassa/POS
    // sintetico, non al login del titolare — mostrarli qui come "le
    // credenziali dell'app" è fuorviante, e il link URL/QR mostrato non è
    // quello corretto per il modulo Comandi. Reindirizza alla landing
    // pubblica dell'istanza (/a/[slug]), lo stesso punto d'ingresso di
    // qualunque altra app: da lì il titolare prosegue verso login/dashboard
    // come già sa fare, invece di finire su una pagina di gestione generica
    // con dati parzialmente sbagliati.
    if (loaded.app_type === 'comandi_ai' && loaded.slug) {
      router.replace(`/a/${loaded.slug}`);
      return;
    }

    setApp(loaded);
    setBuyerForm({
      client_full_name: loaded.client_full_name || '',
      client_phone: loaded.client_phone || '',
      client_tax_id: loaded.client_tax_id || '',
      client_billing_address: loaded.client_billing_address || '',
      client_notes: loaded.client_notes || '',
    });
    setBrandingForm({
      footer_logo_url: loaded.config?.branding?.footer_logo_url || '',
      footer_label: loaded.config?.branding?.footer_label || '',
    });

    // client_password/initial_password non sono più leggibili con la anon/
    // authenticated key (vedi migrazione lockdown_apps_password_columns): si
    // recuperano tramite RPC SECURITY DEFINER che verifica la membership sul
    // tenant dell'app prima di restituirle.
    // Cast mirato: il client `supabase` (src/lib/supabase.ts) non ha un
    // generic Database con le funzioni RPC dichiarate, quindi risolverebbe
    // qui a `never` come altrove nel progetto (vedi audit tsc).
    (supabase.rpc as any)('get_app_client_credentials', { p_app_id: loaded.id }).then(
      ({ data, error }: { data: { client_password: string; initial_password: string }[] | null; error: unknown }) => {
        if (error || !data || !data[0]) return;
        setApp(prev => prev ? { ...prev, client_password: data[0].client_password, initial_password: data[0].initial_password } : prev);
      }
    );
  }

  useEffect(() => {
    async function loadApp() {
      if (!idOrSlug) return;

      const { data: { user: currentUser } } = await supabase.auth.getUser();
      setUser(currentUser);

      // Prima prova a cercare per ID (UUID)
      const { data, error } = await supabase
        .from('apps')
        .select('id, name, config, trial_ends_at, is_active, created_at, blueprint_id, tenant_id, app_type, slug, client_email, client_active, expires_at, auth_mode, client_full_name, client_phone, client_tax_id, client_billing_address, client_notes')
        .eq('id', idOrSlug)
        .single();

      // Se non trovato per ID, prova a cercare per slug
      if (error || !data) {
        const { data: slugData } = await supabase
          .from('apps')
          .select('id, name, config, trial_ends_at, is_active, created_at, blueprint_id, tenant_id, app_type, slug, client_email, client_active, expires_at, auth_mode, client_full_name, client_phone, client_tax_id, client_billing_address, client_notes')
          .eq('slug', idOrSlug)
          .single();

        if (slugData) {
          applyLoadedApp(slugData);
        } else {
          setError('App non trovata o accesso negato');
        }
      } else {
        applyLoadedApp(data);
      }

      setLoading(false);
    }

    loadApp();
  }, [idOrSlug]);

  useEffect(() => {
    if (!app?.tenant_id) return;
    supabase
      .from('tenants')
      .select('plan')
      .eq('id', app.tenant_id)
      .single()
      .then(({ data }) => {
        setTenantPlan((data as { plan?: string } | null)?.plan || null);
      });
  }, [app?.tenant_id]);

  const formatDate = (iso: string | null | undefined) => {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('it-IT');
  };

  const isTrialExpired = (iso: string | undefined) => {
    if (!iso) return false;
    return new Date(iso) < new Date();
  };

  async function handleDelete() {
    if (!app?.id) return;
    if (!confirm('Sei sicuro di voler eliminare questa app? L\'azione è irreversibile.')) return;

    setDeleting(true);
    const { error: deleteError } = await supabase
      .from('apps')
      .delete()
      .eq('id', app.id);

    if (deleteError) {
      console.error('[AppDetail] delete error:', deleteError);
      setError(`Errore eliminazione: ${deleteError.message}`);
      setDeleting(false);
      return;
    }

    // Decrementa fee mensile per l'app eliminata
    try {
      const memberResult = await supabase
        .from('tenant_members')
        .select('tenant_id')
        .eq('user_id', user?.id)
        .single();

      const memberData = memberResult.data as { tenant_id: string } | null | undefined;

      if (memberData?.tenant_id) {
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://zeusx-backend.onrender.com';
        const token = process.env.BACKEND_SERVICE_TOKEN;
        
        await fetch(`${backendUrl}/api/update-app-fee`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-User-ID': user?.id || '',
            'X-User-Email': user?.email || '',
          },
          body: JSON.stringify({ tenantId: memberData.tenant_id, action: 'decrement' }),
        });
      }
    } catch (err) {
      console.error('[AppDetail] errore decrement fee:', err);
      // Non bloccare l'eliminazione se fallisce il decrement
    }

    router.push('/dashboard/projects');
  }

  async function handleClientAccess(action: string) {
    if (!app?.id) return;
    if (action === 'toggle') setToggling(true);
    if (action === 'regenerate-password') setRegenerating(true);
    if (action === 'extend-expiry') setExtending(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/apps/${app.id}/client-access`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ action }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Errore');
        return;
      }

      // Aggiorna lo stato locale dell'app
      if (action === 'toggle') {
        setApp(prev => prev ? { ...prev, client_active: data.client_active } : prev);
      } else if (action === 'regenerate-password') {
        setApp(prev => prev ? { ...prev, client_password: data.new_password, initial_password: data.new_password } : prev);
        alert(`Nuova password generata: ${data.new_password}\nConsegnala al cliente.`);
      } else if (action === 'extend-expiry') {
        setApp(prev => prev ? { ...prev, expires_at: data.new_expires_at, client_active: true } : prev);
      }
    } catch {
      setError('Errore di connessione');
    } finally {
      setToggling(false);
      setRegenerating(false);
      setExtending(false);
    }
  }

  async function handleSaveBuyer() {
    if (!app?.id) return;
    setSavingBuyer(true);
    setBuyerSaved(false);
    setError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/apps/${app.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify(buyerForm),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Errore salvataggio dati acquirente');
        return;
      }

      setApp(prev => prev ? { ...prev, ...buyerForm } : prev);
      setBuyerSaved(true);
      setTimeout(() => setBuyerSaved(false), 2000);
    } catch {
      setError('Errore di connessione');
    } finally {
      setSavingBuyer(false);
    }
  }

  function handleBrandingLogoFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBrandingError('');
    // Stesso limite lato server (route.ts, MAX_LOGO_DATA_URL_LENGTH) — qui
    // controllato prima sul file grezzo per non far attendere l'utente
    // l'encoding base64 di un file già troppo grande.
    if (file.size > 1_000_000) {
      setBrandingError('Immagine troppo grande (max 1MB). Scegline una più leggera.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      setBrandingForm(prev => ({ ...prev, footer_logo_url: (ev.target?.result as string) || '' }));
    };
    reader.readAsDataURL(file);
  }

  async function handleSaveBranding() {
    if (!app?.id) return;
    setSavingBranding(true);
    setBrandingSaved(false);
    setBrandingError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/apps/${app.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ branding: brandingForm }),
      });

      const data = await res.json();

      if (!res.ok) {
        setBrandingError(data.error || 'Errore salvataggio branding');
        return;
      }

      setApp(prev => prev ? { ...prev, config: data.app.config } : prev);
      setBrandingSaved(true);
      setTimeout(() => setBrandingSaved(false), 2000);
    } catch {
      setBrandingError('Errore di connessione');
    } finally {
      setSavingBranding(false);
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback per browser che non supportano clipboard API
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6 text-slate-400">
        Caricamento...
      </div>
    );
  }

  if (error || !app) {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
          {error || 'App non trovata'}
        </div>
        <Link href="/dashboard/projects" className="text-blue-400 hover:underline">
          ← Torna ai progetti
        </Link>
      </div>
    );
  }

  const tables = app.config?.schema?.tables || [];
  const expired = isTrialExpired(app.trial_ends_at);
  const appUrl = app.slug ? `${window.location.origin}/a/${app.slug}` : '';

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/projects" className="text-slate-400 hover:text-white transition">
            ←
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{app.name}</h1>
            <p className="text-slate-400 mt-1">
              Settore: <span className="capitalize text-slate-200">{app.config?.sector || 'custom'}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {app.slug && (
            <a
              href={`/a/${app.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-xl text-sm font-semibold transition flex items-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Apri Landing Page
            </a>
          )}
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="bg-red-600 hover:bg-red-700 disabled:bg-red-900/50 text-white px-4 py-2 rounded-xl text-xs font-medium transition"
          >
            {deleting ? 'Eliminazione...' : 'Elimina App'}
          </button>
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${expired ? 'bg-red-500/10 text-red-300 border border-red-500/30' : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'}`}>
            {expired ? 'Trial scaduto' : 'Attiva'}
          </span>
        </div>
      </div>

      {expired && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <span>⚠️ Il trial di questa app è scaduto. Rinnova il piano per continuare.</span>
          <Link href="/pricing" className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-xs font-medium transition text-center">
            Vai ai Piani
          </Link>
        </div>
      )}

      {/* Accesso Cliente */}
      {app.slug && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Key className="w-5 h-5" />
            Accesso Cliente
          </h2>
          
          <div className="space-y-4">
            {/* Email di login */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-400">Email di login</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={app.client_email || '-'}
                  className="flex-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-emerald-400 font-mono focus:outline-none"
                />
                <button
                  onClick={() => copyToClipboard(app.client_email ?? '')}
                  disabled={!app.client_email}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-900/50 text-white rounded-lg text-sm font-medium transition flex items-center gap-2"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  Copia
                </button>
              </div>
            </div>

            {/* Password iniziale (solo app legacy) */}
            {app.auth_mode !== 'supabase' && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-400">Password iniziale</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={app.client_password || '-'}
                    className="flex-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-amber-400 font-mono focus:outline-none"
                  />
                  <button
                    onClick={() => copyToClipboard(app.client_password ?? '')}
                    disabled={!app.client_password}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-900/50 text-white rounded-lg text-sm font-medium transition flex items-center gap-2"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    Copia
                  </button>
                  <button
                    onClick={() => handleClientAccess('regenerate-password')}
                    disabled={regenerating}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-900/50 text-white rounded-lg text-sm font-medium transition"
                  >
                    {regenerating ? 'Generazione...' : 'Rigenera'}
                  </button>
                </div>
                <p className="text-xs text-slate-500">
                   Il cliente può cambiare la password in qualsiasi momento dall&apos;interno dell&apos;app.
                </p>
              </div>
            )}

            {/* Messaggio Supabase Auth (solo app auth_mode='supabase') */}
            {app.auth_mode === 'supabase' && (
              <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm">
                Autenticazione Supabase Auth attiva. Il cliente si registra autonomamente dalla Landing Page via mail ({app.client_email || 'client_email'}).
              </div>
            )}

            {/* Link di accesso */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-400">Link di accesso</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={appUrl}
                  className="flex-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-300 focus:outline-none"
                />
                <button
                  onClick={() => copyToClipboard(appUrl)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition"
                >
                  Copia
                </button>
                <a
                  href={`/a/${app.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition flex items-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" />
                  Vai
                </a>
              </div>
            </div>

            {/* QR Code per accesso mobile */}
            <div className="flex flex-col items-center pt-4">
              <div className="bg-white p-4 rounded-xl mb-2">
                <QRCodeSVG 
                  value={appUrl}
                  size={100}
                  bgColor="#ffffff"
                  fgColor="#000000"
                  level="M"
                />
              </div>
              <p className="text-xs text-slate-400">
                Scansiona per aprire su smartphone
              </p>
            </div>

            {/* Stato e scadenza */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              {/* Toggle attivo/bloccato */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-400">Stato accesso</label>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleClientAccess('toggle')}
                    disabled={toggling}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                      app.client_active ? 'bg-emerald-600' : 'bg-red-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        app.client_active ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                  <span className={`text-sm font-medium ${app.client_active ? 'text-emerald-400' : 'text-red-400'}`}>
                    {app.client_active ? 'Attivo' : 'Bloccato'}
                  </span>
                </div>
              </div>

              {/* Data scadenza */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-400">Scadenza</label>
                <p className="text-sm text-slate-300">{formatDate(app.expires_at)}</p>
              </div>

              {/* Email cliente */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-400">Email cliente</label>
                <p className="text-sm text-slate-300">{app.client_email || '-'}</p>
              </div>
            </div>

            {/* Pulsante estendi scadenza */}
            <div className="pt-2">
              <button
                onClick={() => handleClientAccess('extend-expiry')}
                disabled={extending}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-900/50 text-white rounded-lg text-sm font-medium transition"
              >
                {extending ? 'Estensione...' : '🔄 Estendi scadenza di 30 giorni'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dati Acquirente */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <h2 className="text-lg font-semibold">Dati Acquirente</h2>
        <p className="text-sm text-slate-400 -mt-2">
          Anagrafica del titolare che usa l&apos;app e paga l&apos;abbonamento (diversa dalle credenziali di accesso qui sopra).
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-400">Nome / Ragione Sociale</label>
            <input
              type="text"
              value={buyerForm.client_full_name}
              onChange={(e) => setBuyerForm(prev => ({ ...prev, client_full_name: e.target.value }))}
              placeholder="Mario Rossi / Rossi S.r.l."
              className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-400">Telefono</label>
            <input
              type="text"
              value={buyerForm.client_phone}
              onChange={(e) => setBuyerForm(prev => ({ ...prev, client_phone: e.target.value }))}
              placeholder="+39 333 1234567"
              className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-400">P.IVA / Codice Fiscale</label>
            <input
              type="text"
              value={buyerForm.client_tax_id}
              onChange={(e) => setBuyerForm(prev => ({ ...prev, client_tax_id: e.target.value }))}
              placeholder="IT01234567890"
              className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-400">Indirizzo di fatturazione</label>
            <input
              type="text"
              value={buyerForm.client_billing_address}
              onChange={(e) => setBuyerForm(prev => ({ ...prev, client_billing_address: e.target.value }))}
              placeholder="Via Roma 1, 20100 Milano (MI)"
              className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <label className="text-sm font-medium text-slate-400">Note</label>
            <textarea
              value={buyerForm.client_notes}
              onChange={(e) => setBuyerForm(prev => ({ ...prev, client_notes: e.target.value }))}
              rows={3}
              placeholder="Annotazioni libere sul cliente..."
              className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500 resize-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSaveBuyer}
            disabled={savingBuyer}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-900/50 text-white rounded-lg text-sm font-medium transition"
          >
            {savingBuyer ? 'Salvataggio...' : 'Salva dati acquirente'}
          </button>
          {buyerSaved && (
            <span className="text-emerald-400 text-sm flex items-center gap-1">
              <Check className="w-4 h-4" /> Salvato
            </span>
          )}
        </div>
      </div>

      {/* Brandizza la tua app (white label, piano Business) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Brandizza la tua app</h2>
            <p className="text-sm text-slate-400 mt-1">
              Sostituisci &quot;ShardApps by MUSINO&quot; in fondo alla sidebar con il tuo logo, così l&apos;app sembra fatta interamente da te.
            </p>
          </div>
          {tenantPlan !== 'business' && (
            <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-400">
              Piano Business
            </span>
          )}
        </div>

        {tenantPlan === undefined ? (
          <p className="text-sm text-slate-500">Verifica piano...</p>
        ) : tenantPlan !== 'business' ? (
          <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-sm text-slate-400">
            Questa funzione è riservata al piano Business.{' '}
            <Link href="/pricing" className="text-indigo-400 hover:underline">Passa al piano Business</Link> per rimuovere il branding ShardApps dalle tue app.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-700 bg-slate-800">
                {brandingForm.footer_logo_url ? (
                  <img src={brandingForm.footer_logo_url} alt="Il tuo logo" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[10px] text-slate-500">ShardApps</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <label className="cursor-pointer rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-600">
                  Carica logo
                  <input type="file" accept="image/*" onChange={handleBrandingLogoFile} className="hidden" />
                </label>
                {brandingForm.footer_logo_url && (
                  <button
                    type="button"
                    onClick={() => setBrandingForm(prev => ({ ...prev, footer_logo_url: '' }))}
                    className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-400 hover:border-red-700 hover:text-red-400"
                  >
                    Rimuovi
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-400">Testo sotto il logo (opzionale)</label>
              <input
                type="text"
                value={brandingForm.footer_label}
                onChange={(e) => setBrandingForm(prev => ({ ...prev, footer_label: e.target.value }))}
                placeholder="es. by Rossi Digital"
                maxLength={40}
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {brandingError && <p className="text-sm text-red-400">{brandingError}</p>}

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSaveBranding}
                disabled={savingBranding}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-900/50 text-white rounded-lg text-sm font-medium transition"
              >
                {savingBranding ? 'Salvataggio...' : 'Salva branding'}
              </button>
              {brandingSaved && (
                <span className="text-emerald-400 text-sm flex items-center gap-1">
                  <Check className="w-4 h-4" /> Salvato
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Info app */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-lg font-semibold">Dettagli App</h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">Creata il</span>
              <span>{formatDate(app.created_at)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Trial fino al</span>
              <span>{formatDate(app.trial_ends_at)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Stato</span>
              <span>{app.is_active ? 'Attiva' : 'Disattivata'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">ID App</span>
              <span className="font-mono text-xs">{app.id.slice(0, 8)}...</span>
            </div>
          </div>
        </div>

        {/* Tabelle */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-lg font-semibold">Tabelle del Gestionale</h2>

          {tables.length === 0 ? (
            <p className="text-slate-500 text-sm">Nessuna tabella definita nel blueprint.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {tables.map((table: any) => (
                <div key={table.name} className="border border-slate-800 rounded-xl p-4 hover:border-slate-600 transition">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xl">{table.icon || '📄'}</span>
                    <div>
                      <h3 className="font-medium">{table.label || table.name}</h3>
                      <p className="text-xs text-slate-500">{table.fields?.length || 0} campi</p>
                    </div>
                  </div>
                    <div className="space-y-1">
                      {(table.fields || []).slice(0, 4).map((field: any, index: number) => (
                        <div key={field.name || field.id || index} className="text-xs text-slate-400 flex justify-between">
                          <span>{field.label || field.name || field.id}</span>
                          <span className="text-slate-600 uppercase">{field.type}</span>
                        </div>
                      ))}
                    {(table.fields || []).length > 4 && (
                      <p className="text-xs text-slate-500 mt-2">+ altri campi...</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}