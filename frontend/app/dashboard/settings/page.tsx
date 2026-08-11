'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, Check } from 'lucide-react';
import { supabase } from '@/src/lib/supabase';
import { useLanguage } from '@/src/lib/LanguageContext';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';

export default function SettingsPage() {
  const { t } = useLanguage();
  const { canInstall, isIos, isIosNonSafari, isStandalone, promptInstall } = useInstallPrompt();
  // "App in mobile": il dispositivo corrente è un telefono/tablet, non solo
  // una finestra desktop ridimensionata — mostrare il QR (pensato per essere
  // inquadrato DA un altro dispositivo) non avrebbe senso se si sta già
  // guardando la pagina dal telefono stesso.
  const [isMobileDevice, setIsMobileDevice] = useState(false);
  useEffect(() => {
    setIsMobileDevice(/Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent));
  }, []);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  // Piano del tenant a cui appartiene l'utente: stessa query di app/pricing/
  // page.tsx (tenant_members -> tenants.plan), così l'etichetta qui e in
  // pricing sono sempre coerenti tra loro.
  const [currentPlan, setCurrentPlan] = useState<string | null>(null);

  useEffect(() => {
    async function loadCurrentPlan() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: memberships } = await supabase
        .from('tenant_members')
        .select('tenant_id')
        .eq('user_id', user.id)
        .limit(1);

      const tenantId = memberships?.[0]?.tenant_id;
      if (!tenantId) return;

      const { data: tenant } = await supabase
        .from('tenants')
        .select('plan')
        .eq('id', tenantId)
        .single();

      setCurrentPlan(tenant?.plan || 'free');
    }
    loadCurrentPlan();
  }, []);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (newPassword.length < 6) {
      setPasswordError(t('settings_password_error_too_short'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t('settings_password_error_mismatch'));
      return;
    }

    setPasswordLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        if (error.message?.includes('Auth session missing') || error.message?.includes('session')) {
          setPasswordError(t('settings_password_error_session'));
        } else {
          setPasswordError(error.message);
        }
      } else {
        setPasswordSuccess(t('settings_password_success'));
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (err: any) {
      setPasswordError(err.message || t('settings_password_error_generic'));
    } finally {
      setPasswordLoading(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('settings_title')}</h1>
        <p className="text-slate-400 mt-1">{t('settings_subtitle')}</p>
      </div>

      <div className="space-y-6">

        {/* SEZIONE 1: PROFILO */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <h3 className="text-base font-bold text-slate-200 border-b border-slate-800/60 pb-2">{t('settings_profile_section_title')}</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 uppercase tracking-wider font-semibold mb-2">{t('settings_plan_label')}</label>
              <Link
                href="/pricing"
                className="w-full bg-slate-950 border border-slate-800 text-indigo-400 rounded-xl px-4 py-2.5 text-sm font-bold uppercase flex items-center justify-between hover:border-indigo-500/60 transition"
              >
                {currentPlan || '...'}
                <span className="text-xs font-normal normal-case text-slate-500">{t('settings_plan_manage')}</span>
              </Link>
            </div>
            <div>
              <label className="block text-xs text-slate-400 uppercase tracking-wider font-semibold mb-2">{t('settings_account_status_label')}</label>
              <div className="w-full bg-slate-950 border border-slate-800 text-emerald-400 rounded-xl px-4 py-2.5 text-sm font-medium flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span> {t('settings_account_status_active')}
              </div>
            </div>
          </div>
        </div>

        {/* SEZIONE 2: CAMBIO PASSWORD */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <h3 className="text-base font-bold text-slate-200 border-b border-slate-800/60 pb-2">{t('settings_password_section_title')}</h3>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 uppercase tracking-wider font-semibold mb-2">{t('settings_new_password_label')}</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t('settings_new_password_placeholder')}
                className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-4 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 uppercase tracking-wider font-semibold mb-2">{t('settings_confirm_password_label')}</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('settings_confirm_password_placeholder')}
                className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-4 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition"
              />
            </div>

            {passwordError && (
              <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2">
                {passwordError}
              </div>
            )}
            {passwordSuccess && (
              <div className="text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-2">
                {passwordSuccess}
              </div>
            )}

            <button
              type="submit"
              disabled={passwordLoading || !newPassword || !confirmPassword}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-800 disabled:text-slate-500 text-white px-6 py-2.5 rounded-xl font-medium text-sm transition"
            >
              {passwordLoading ? t('settings_password_button_loading') : t('settings_password_button')}
            </button>
          </form>
        </div>

        {/* SEZIONE 3: APP MOBILE */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <h3 className="text-base font-bold text-slate-200 border-b border-slate-800/60 pb-2">{t('settings_mobile_app_section_title')}</h3>
          {isMobileDevice ? (
            // Già sul telefono: niente QR (inquadrarlo da sé stessi non ha
            // senso), offri direttamente l'installazione sul dispositivo
            // corrente — stesso hook (useInstallPrompt) del banner PWA delle
            // app cliente, qui usato per il manifest root di ShardApps.
            <div className="space-y-3">
              {isStandalone ? (
                <p className="flex items-center gap-2 text-sm text-emerald-400">
                  <Check size={16} /> {t('settings_mobile_app_already_installed')}
                </p>
              ) : canInstall ? (
                <>
                  <p className="text-sm text-slate-300">{t('settings_mobile_app_install_desc')}</p>
                  <button
                    type="button"
                    onClick={promptInstall}
                    className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-700"
                  >
                    <Download size={16} /> {t('settings_mobile_app_install_button')}
                  </button>
                </>
              ) : isIosNonSafari ? (
                <p className="text-sm text-slate-300">{t('settings_mobile_app_ios_non_safari')}</p>
              ) : isIos ? (
                <p className="text-sm text-slate-300">{t('settings_mobile_app_ios_instructions')}</p>
              ) : (
                <p className="text-sm text-slate-300">{t('settings_mobile_app_install_desc')}</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="flex-1">
                <p className="text-sm text-slate-300 mb-2">{t('settings_mobile_app_desc')}</p>
                <p className="text-xs text-slate-500">
                  {t('settings_mobile_app_hint')}
                </p>
              </div>
              <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-4 flex items-center justify-center">
                <img
                  src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=https://zeusx.app"
                  alt={t('settings_mobile_app_qr_alt')}
                  className="w-30 h-30 object-contain"
                />
              </div>
            </div>
          )}
        </div>

       </div>
    </div>
  );
}