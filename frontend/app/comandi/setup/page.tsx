'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Building2, Check, CheckCircle2, Copy, ExternalLink, Loader2, MapPin, Phone, Receipt, Sparkles } from 'lucide-react';
import { useLanguage } from '@/src/lib/LanguageContext';
import LanguageSelector from '@/components/LanguageSelector';
import { supabaseBrowser } from '@/src/lib/supabase-browser';
import { setupTenantAction } from '@/app/actions/comandi-tenant';
import { provisionComandiAppAction } from '@/app/actions/comandi-provisioning';

export default function ComandiSetupPage() {
  const { t } = useLanguage();
  const router = useRouter();

  const [checkingSession, setCheckingSession] = useState(true);
  const [businessName, setBusinessName] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [seedDemoCatalog, setSeedDemoCatalog] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [provisionedResult, setProvisionedResult] = useState<{ slug: string; posEmail?: string; posPassword?: string } | null>(null);
  const [copiedField, setCopiedField] = useState<'email' | 'password' | null>(null);

  // Guard: la pagina di onboarding richiede una sessione attiva (l'utente
  // arriva qui solo dopo login/registrazione da /comandi).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabaseBrowser.auth.getSession();
      if (cancelled) return;
      if (!session) {
        router.push('/comandi');
        return;
      }
      setCheckingSession(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!businessName.trim()) {
      setError(t('comandi_setup_error_business_name_required'));
      return;
    }

    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabaseBrowser.auth.getSession();

      if (!session?.access_token) {
        router.push('/comandi');
        return;
      }

      const result = await setupTenantAction({
        businessName: businessName.trim(),
        vatNumber: vatNumber.trim() || undefined,
        address: address.trim() || undefined,
        city: city.trim() || undefined,
        phone: phone.trim() || undefined,
        seedDemoCatalog,
        accessToken: session.access_token,
      });

      if (!result.success) {
        setError(result.error || t('comandi_setup_error_generic'));
        setLoading(false);
        return;
      }

      // Provisiona subito l'istanza (landing/login/dashboard/cassa dedicati
      // su /a/{slug}): il tenant appena creato ha già 1 slot incluso (vedi
      // setupTenantAction), quindi il controllo slot qui passa sempre per
      // una prima registrazione. Idempotente: se esiste già un'istanza
      // Comandi per questo tenant, restituisce quella invece di duplicarla.
      const provisionResult = await provisionComandiAppAction({ accessToken: session.access_token });

      if (!provisionResult.success || !provisionResult.slug) {
        // I dati aziendali sono comunque salvati: /dashboard/comandi fa da
        // rete di sicurezza e ritenta il provisioning da lì.
        console.error('[ComandiSetupPage] Errore provisionComandiAppAction:', provisionResult.error);
        router.push(`/dashboard/comandi?t=${Date.now()}`);
        return;
      }

      // Mostra le credenziali di primo accesso prima di reindirizzare:
      // l'utente deve poterle copiare/consegnare, non solo intravederle.
      setProvisionedResult({
        slug: provisionResult.slug,
        posEmail: provisionResult.posEmail,
        posPassword: provisionResult.posPassword,
      });
      setLoading(false);
    } catch (err) {
      console.error('[ComandiSetupPage] Errore setupTenantAction:', err);
      setError(t('comandi_setup_error_network'));
      setLoading(false);
    }
  };

  const copyCred = (value: string, field: 'email' | 'password') => {
    navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <Loader2 size={32} className="animate-spin text-amber-500" />
      </div>
    );
  }

  if (provisionedResult) {
    return (
      <div className="bg-slate-950 text-white min-h-screen w-full font-sans flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-2xl border border-green-700/50 bg-gradient-to-br from-green-950/40 to-emerald-950/20 p-8 flex flex-col items-center text-center gap-3">
          <CheckCircle2 className="w-10 h-10 text-green-400" />
          <p className="text-lg font-bold text-white">{t('creator_comandi_success_title')}</p>
          <p className="text-sm text-slate-400 max-w-sm">{t('creator_comandi_success_desc')}</p>

          {provisionedResult.posEmail && provisionedResult.posPassword && (
            <div className="w-full rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-left mt-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
                {t('creator_comandi_success_credentials_title')}
              </p>
              <div className="space-y-2">
                <div>
                  <p className="text-[11px] text-slate-500 mb-0.5">{t('creator_comandi_success_credentials_email')}</p>
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-sm text-slate-200 break-all">{provisionedResult.posEmail}</p>
                    <button
                      type="button"
                      onClick={() => copyCred(provisionedResult.posEmail!, 'email')}
                      className="shrink-0 text-slate-500 hover:text-white"
                      title="Copia"
                    >
                      {copiedField === 'email' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500 mb-0.5">{t('creator_comandi_success_credentials_password')}</p>
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-sm text-slate-200">{provisionedResult.posPassword}</p>
                    <button
                      type="button"
                      onClick={() => copyCred(provisionedResult.posPassword!, 'password')}
                      className="shrink-0 text-slate-500 hover:text-white"
                      title="Copia"
                    >
                      {copiedField === 'password' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 mt-3">{t('creator_comandi_success_credentials_hint')}</p>
            </div>
          )}

          <button
            type="button"
            onClick={() => router.push(`/a/${provisionedResult.slug}?t=${Date.now()}`)}
            className="mt-2 flex items-center gap-2 px-5 py-3 rounded-lg font-semibold bg-amber-600 text-white hover:bg-amber-500 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            {t('creator_comandi_success_cta')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-950 text-white min-h-screen w-full font-sans relative">
      <div className="absolute top-6 right-6 z-30">
        <LanguageSelector />
      </div>

      <div className="flex min-h-screen items-center justify-center px-4 py-16">
        <div className="w-full max-w-lg space-y-8">
          <div className="text-center">
            <Link
              href="/comandi"
              className="text-3xl font-black tracking-tighter text-white"
            >
              Comand<span className="bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent">AI</span>
            </Link>
            <p className="mt-3 text-xl font-bold text-white">{t('comandi_setup_title')}</p>
            <p className="mt-1 text-sm text-slate-400">{t('comandi_setup_subtitle')}</p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 backdrop-blur">
            {error && (
              <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
                <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <Building2 size={13} />
                  {t('comandi_setup_business_name_label')}
                </label>
                <input
                  type="text"
                  required
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder={t('comandi_setup_business_name_placeholder')}
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                />
              </div>

              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <Receipt size={13} />
                  {t('comandi_setup_vat_label')}
                </label>
                <input
                  type="text"
                  value={vatNumber}
                  onChange={(e) => setVatNumber(e.target.value)}
                  placeholder={t('comandi_setup_vat_placeholder')}
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    <MapPin size={13} />
                    {t('comandi_setup_address_label')}
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder={t('comandi_setup_address_placeholder')}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                    {t('comandi_setup_city_label')}
                  </label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder={t('comandi_setup_city_placeholder')}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <Phone size={13} />
                  {t('comandi_setup_phone_label')}
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t('comandi_setup_phone_placeholder')}
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                />
              </div>

              <label className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={seedDemoCatalog}
                  onChange={(e) => setSeedDemoCatalog(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-800 text-amber-600 focus:ring-amber-500/40"
                />
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-white">
                    <Sparkles size={14} className="text-amber-400" />
                    {t('comandi_setup_seed_demo_label')}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-400">{t('comandi_setup_seed_demo_desc')}</span>
                </span>
              </label>

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-600 py-3 text-sm font-bold text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading && <Loader2 size={18} className="animate-spin" />}
                {loading ? t('comandi_setup_submit_loading') : t('comandi_setup_submit_button')}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
