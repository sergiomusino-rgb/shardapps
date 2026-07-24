'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Building2, Loader2, MapPin, Phone, Receipt, Sparkles } from 'lucide-react';
import { useLanguage } from '@/src/lib/LanguageContext';
import LanguageSelector from '@/components/LanguageSelector';
import { supabaseBrowser } from '@/src/lib/supabase-browser';
import { setupTenantAction } from '@/app/actions/comandi-tenant';

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

      router.push(`/dashboard/comandi?t=${Date.now()}`);
    } catch (err) {
      console.error('[ComandiSetupPage] Errore setupTenantAction:', err);
      setError(t('comandi_setup_error_network'));
      setLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <Loader2 size={32} className="animate-spin text-amber-500" />
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
              Comandi<span className="bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent">AI</span>
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
