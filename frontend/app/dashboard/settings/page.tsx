'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/src/lib/supabase';

export default function SettingsPage() {
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
      setPasswordError('La password deve essere di almeno 6 caratteri');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Le password non coincidono');
      return;
    }

    setPasswordLoading(true);
    try {
      const { data, error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        if (error.message?.includes('Auth session missing') || error.message?.includes('session')) {
          setPasswordError('Sessione non valida. Effettua di nuovo il login.');
        } else {
          setPasswordError(error.message);
        }
      } else {
        setPasswordSuccess('Password cambiata con successo!');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (err: any) {
      setPasswordError(err.message || 'Errore durante il cambio password');
    } finally {
      setPasswordLoading(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Impostazioni</h1>
        <p className="text-slate-400 mt-1">Gestisci le configurazioni del tuo account, le chiavi API e la fatturazione.</p>
      </div>

      <div className="space-y-6">
        
        {/* SEZIONE 1: PROFILO */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <h3 className="text-base font-bold text-slate-200 border-b border-slate-800/60 pb-2">Profilo Utente</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 uppercase tracking-wider font-semibold mb-2">Piano Utente</label>
              <Link
                href="/pricing"
                className="w-full bg-slate-950 border border-slate-800 text-indigo-400 rounded-xl px-4 py-2.5 text-sm font-bold uppercase flex items-center justify-between hover:border-indigo-500/60 transition"
              >
                {currentPlan || '...'}
                <span className="text-xs font-normal normal-case text-slate-500">Gestisci →</span>
              </Link>
            </div>
            <div>
              <label className="block text-xs text-slate-400 uppercase tracking-wider font-semibold mb-2">Account Status</label>
              <div className="w-full bg-slate-950 border border-slate-800 text-emerald-400 rounded-xl px-4 py-2.5 text-sm font-medium flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span> Attivo
              </div>
            </div>
          </div>
        </div>

        {/* SEZIONE 2: CAMBIO PASSWORD */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <h3 className="text-base font-bold text-slate-200 border-b border-slate-800/60 pb-2">Cambia Password</h3>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 uppercase tracking-wider font-semibold mb-2">Nuova Password</label>
              <input 
                type="password" 
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Inserisci nuova password"
                className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-4 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 uppercase tracking-wider font-semibold mb-2">Conferma Password</label>
              <input 
                type="password" 
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Conferma nuova password"
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
              {passwordLoading ? 'Cambio in corso...' : 'Cambia Password'}
            </button>
          </form>
        </div>

        {/* SEZIONE 3: APP MOBILE */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <h3 className="text-base font-bold text-slate-200 border-b border-slate-800/60 pb-2">App Mobile</h3>
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="flex-1">
              <p className="text-sm text-slate-300 mb-2">Scansiona il QR code per aprire l'app sul tuo telefono</p>
              <p className="text-xs text-slate-500">
                Collega la tua area riservata direttamente dal tuo dispositivo mobile.
              </p>
            </div>
            <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-4 flex items-center justify-center">
              <img 
                src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=https://zeusx.app" 
                alt="QR Code App Mobile"
                className="w-30 h-30 object-contain"
              />
            </div>
          </div>
        </div>

       </div>
    </div>
  );
}