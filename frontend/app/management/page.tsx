'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/src/lib/LanguageContext';
import { supabaseBrowser } from '@/src/lib/supabase-browser';

const supabase = supabaseBrowser;

interface AppRegistryItem {
  id: string;
  app_name: string;
  app_url: string;
  status: string;
  monthly_fee: number;
  zeusx_share: number;
  created_at: string;
  total_zeusx_due: number;
}

export default function ManagementPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [apps, setApps] = useState<AppRegistryItem[]>([]);
  const [totalZeusxDue, setTotalZeusxDue] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLanguage();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    
    // Verifica autenticazione
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      router.push('/login');
      return;
    }

    // Carica le app del rivenditore
    // Cast mirato: il client `supabase` non ha un generic Database con le
    // funzioni RPC dichiarate, quindi risolverebbe qui a `never` come
    // altrove nel progetto (vedi audit tsc).
    const { data, error: appsError } = await (supabase.rpc as any)('get_reseller_apps_with_total', {
      p_reseller_id: session.user.id
    }) as { data: AppRegistryItem[] | null; error: { message: string } | null };

    if (appsError) {
      setError(appsError.message);
    } else {
      setApps(data || []);
      if (data && data.length > 0) {
        setTotalZeusxDue(data[0].total_zeusx_due || 0);
      }
    }

    setLoading(false);
  };

  const toggleAppStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'suspended' : 'active';

    // Cast mirato: frontend/types/database.ts non copre app_registry,
    // quindi il client tipizzato risolverebbe qui a `never` come altrove
    // nel progetto (vedi audit tsc).
    const { error } = await (supabase as any)
      .from('app_registry')
      .update({ status: newStatus })
      .eq('id', id);

    if (!error) {
      loadData();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-slate-400">{t('admin_loading')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <div className="text-center p-6 bg-red-900/20 rounded-lg border border-red-800">
          <p className="text-red-400">{error}</p>
          <button 
            onClick={() => router.push('/dashboard')}
            className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            {t('back_to_dashboard')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-slate-950 min-h-screen text-white">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t('management_title')}</h1>
        <p className="text-slate-400 mt-1">{t('management_subtitle')}</p>
      </div>

      {/* Card Totale ZEUSX */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-lg p-6 mb-6 text-white">
        <h2 className="text-lg font-medium">{t('management_total_zeusx')}</h2>
        <p className="text-3xl font-bold mt-2">€ {totalZeusxDue.toFixed(2)}</p>
        <p className="text-indigo-100 text-sm mt-1">{t('management_total_description')}</p>
      </div>

      {/* Tabella App */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-slate-800">
          <thead className="bg-slate-800">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                {t('management_table_name')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                {t('management_table_url')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                {t('management_table_status')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                {t('management_table_monthly_fee')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                {t('management_table_zeusx_share')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                {t('management_table_actions')}
              </th>
            </tr>
          </thead>
          <tbody className="bg-slate-900 divide-y divide-slate-800">
            {apps.map((app) => (
              <tr key={app.id} className="hover:bg-slate-800/50">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">
                  {app.app_name}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400">
                  <a 
                    href={app.app_url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-indigo-400 hover:text-indigo-300"
                  >
                    {app.app_url}
                  </a>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                    app.status === 'active' 
                      ? 'bg-green-600/20 text-green-400' 
                      : 'bg-red-600/20 text-red-400'
                  }`}>
                    {app.status === 'active' ? t('management_status_active') : t('management_status_suspended')}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                  € {app.monthly_fee.toFixed(2)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                  € {app.zeusx_share.toFixed(2)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <button
                    onClick={() => toggleAppStatus(app.id, app.status)}
                    className={`px-3 py-1 rounded text-sm ${
                      app.status === 'active'
                        ? 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
                        : 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
                    }`}
                  >
                    {app.status === 'active' ? t('management_action_suspend') : t('management_action_activate')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {apps.length === 0 && (
          <div className="p-6 text-center text-slate-500">
            {t('management_no_apps')}
          </div>
        )}
      </div>
    </div>
  );
}