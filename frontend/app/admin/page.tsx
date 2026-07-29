'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
} from 'recharts';
import { useLanguage } from '@/src/lib/LanguageContext';

// ============================================================================
// Takeover Modal Component
// ============================================================================

function TakeoverModal({ 
  isOpen, 
  onClose, 
  appName, 
  onConfirm 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  appName: string;
  onConfirm: () => void;
}) {
  const { t } = useLanguage();
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 max-w-md w-full">
        <h3 className="text-lg font-bold text-white mb-4">{t('admin_takeover_confirm_title')}</h3>
        <p className="text-slate-300 mb-6">
          {t('admin_takeover_confirm_message').replace('{appName}', appName || 'Nome App')}
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-400 hover:text-white transition"
          >
            {t('admin_takeover_cancel')}
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition font-medium"
          >
            {t('admin_takeover_confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

const ADMIN_USER_ID = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';

const PLAN_PRICES: Record<string, number> = {
  free: 0,
  starter: 10,
  pro: 25,
  business: 50,
};

const PLAN_COLORS: Record<string, string> = {
  free: '#64748b',
  starter: '#10b981',
  pro: '#3b82f6',
  business: '#8b5cf6',
};

const PIE_COLORS = ['#64748b', '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b'];

function KpiCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className={`bg-gradient-to-br ${color} rounded-xl p-5`}>
      <div className="text-xs opacity-80 uppercase font-medium">{label}</div>
      <div className="text-3xl font-bold mt-1">{value}</div>
    </div>
  );
}

export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [data, setData] = useState<any>(null);
  const [resellerDebts, setResellerDebts] = useState<any[]>([]);
  const [debtsLoading, setDebtsLoading] = useState(false);
  const [tab, setTab] = useState('dash');
  const [takeoverModal, setTakeoverModal] = useState<{
    isOpen: boolean;
    appId: string | null;
    appName: string;
  }>({ isOpen: false, appId: null, appName: '' });
  const [takeoverLoading, setTakeoverLoading] = useState(false);
  const { t } = useLanguage();

  useEffect(() => { boot(); }, []);

  async function boot() {
    const { data: { user } } = await supabaseBrowser.auth.getUser();
    if (!user || user.id !== ADMIN_USER_ID) { setDenied(true); setLoading(false); return; }
    await loadData();
  }

  // Load reseller debts when switching to debts tab
  useEffect(() => {
    if (tab === 'debts' && !denied) {
      loadResellerDebts();
    }
  }, [tab, denied]);

  async function loadData() {
    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      const token = session?.access_token;
      if (!token) return;

      const res = await fetch('/api/admin/stats', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error(t('admin_error_loading'));
      const json = await res.json();
      setData(json);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  async function loadResellerDebts() {
    setDebtsLoading(true);
    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      const token = session?.access_token;
      if (!token) return;

      const res = await fetch('/api/admin/reseller-debts', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const json = await res.json();
        setResellerDebts(json.data || []);
      }
    } catch (err) { console.error(err); }
    finally { setDebtsLoading(false); }
  }

  async function markAsPaid(resellerId: string) {
    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      const token = session?.access_token;
      if (!token) return;

      const res = await fetch('/api/admin/mark-paid', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ resellerId }),
      });

      if (res.ok) {
        loadResellerDebts();
      }
    } catch (err) { console.error(err); }
  }

  async function executeTakeover(appId: string) {
    setTakeoverLoading(true);
    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      const token = session?.access_token;
      if (!token) return;

      const res = await fetch('/api/admin/takeover', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ app_id: appId }),
      });

      if (res.ok) {
        // Refresh data after takeover
        loadData();
        setTakeoverModal({ isOpen: false, appId: null, appName: '' });
      } else {
        const error = await res.json();
        alert(error.error || t('admin_takeover_error'));
      }
    } catch (err) { console.error(err); }
    finally { setTakeoverLoading(false); }
  }

  if (loading) return <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center text-xl">{t('admin_loading')}</div>;
  if (denied) return <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center text-xl text-red-400">{t('admin_denied')}</div>;
  if (!data) return <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center text-xl">{t('admin_error_loading')}</div>;

  const { totals, dist, chartData, recentApps } = data;
  const pieData = Object.entries(dist).map(([name, value]) => ({ name, value }));
  const fmtEur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n);
  const estimatedRevenue = Object.entries(dist).reduce((sum, [plan, count]) => sum + (Number(count) || 0) * (PLAN_PRICES[plan] || 0), 0);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
       <div className="border-b border-slate-800 px-6 py-4">
         <div className="max-w-7xl mx-auto">
           <div>
             <h1 className="text-2xl font-bold">{t('admin_title')}</h1>
             <p className="text-slate-400 text-sm">{t('admin_subtitle')}</p>
           </div>
         </div>
       </div>

       {/* Tabs */}
       <div className="border-b border-slate-800 px-6">
         <div className="max-w-7xl mx-auto flex gap-1">
           {[
             { id: 'dash', label: t('admin_tab_dash') },
             { id: 'revenue', label: t('admin_tab_revenue') },
             { id: 'plans', label: t('admin_tab_plans') },
             { id: 'apps', label: t('admin_tab_apps') },
             { id: 'debts', label: t('admin_tab_debts') },
           ].map(item => (
             <button
               key={item.id}
               onClick={() => setTab(item.id)}
               className={`px-4 py-3 text-sm font-semibold border-b-2 transition ${
                 tab === item.id
                   ? 'border-indigo-500 text-indigo-400'
                   : 'border-transparent text-slate-400 hover:text-white'
               }`}
             >
               {item.label}
             </button>
           ))}
         </div>
       </div>

       <div className="max-w-7xl mx-auto p-6">
         {/* PANORAMICA */}
         {tab === 'dash' && (
           <div className="space-y-6">
             <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
               <KpiCard label={t('admin_kpi_revenue')} value={fmtEur(totals.revenue || 0)} color="from-emerald-600 to-emerald-700" />
               <KpiCard label={t('admin_kpi_estimated')} value={fmtEur(estimatedRevenue)} color="from-blue-600 to-blue-700" />
               <KpiCard label={t('admin_kpi_tenants')} value={totals.tenants} color="from-purple-600 to-purple-700" />
               <KpiCard label={t('admin_kpi_active_apps')} value={totals.activeApps} color="from-amber-600 to-amber-700" />
             </div>

             <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
               <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                 <h3 className="text-sm font-semibold text-slate-300 mb-4">{t('admin_chart_monthly')}</h3>
                 {chartData.length === 0 ? (
                   <p className="text-slate-500 text-sm">{t('admin_chart_no_data')}</p>
                 ) : (
                   <ResponsiveContainer width="100%" height={200}>
                     <LineChart data={chartData}>
                       <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                       <XAxis dataKey="month" stroke="#64748b" fontSize={12} />
                       <YAxis stroke="#64748b" fontSize={12} />
                       <Tooltip
                         contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                         formatter={(v: any) => fmtEur(v)}
                       />
                       <Line type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} />
                     </LineChart>
                   </ResponsiveContainer>
                 )}
               </div>

               <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                 <h3 className="text-sm font-semibold text-slate-300 mb-4">{t('admin_chart_plan_dist')}</h3>
                 {pieData.length === 0 ? (
                   <p className="text-slate-500 text-sm">{t('admin_chart_no_data')}</p>
                 ) : (
                   <div className="flex items-center gap-4">
                     <ResponsiveContainer width={160} height={160}>
                       <PieChart>
                         <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value">
                           {pieData.map((_, i) => (
                             <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                           ))}
                         </Pie>
                         <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} />
                       </PieChart>
                     </ResponsiveContainer>
                     <div className="flex-1 space-y-2">
                       {pieData.map((d: any, i: number) => (
                         <div key={d.name} className="flex items-center gap-2">
                           <div className="w-3 h-3 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                           <span className="text-sm text-slate-300">{d.name}</span>
                           <span className="text-sm font-bold ml-auto">{d.value}</span>
                         </div>
                       ))}
                     </div>
                   </div>
                 )}
               </div>

               <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                 <h3 className="text-sm font-semibold text-slate-300 mb-4">{t('admin_chart_app_status')}</h3>
                 <div className="space-y-4">
                   <div>
                     <div className="flex justify-between text-sm mb-1">
                       <span className="text-slate-400">{t('admin_status_active')}</span>
                       <span className="font-bold text-emerald-400">{totals.activeApps}</span>
                     </div>
                     <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
                       <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${totals.apps ? (totals.activeApps / totals.apps) * 100 : 0}%` }} />
                     </div>
                   </div>
                   <div>
                     <div className="flex justify-between text-sm mb-1">
                       <span className="text-slate-400">{t('admin_status_expired')}</span>
                       <span className="font-bold text-red-400">{totals.expiredApps}</span>
                     </div>
                     <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
                       <div className="h-full bg-red-500 rounded-full" style={{ width: `${totals.apps ? (totals.expiredApps / totals.apps) * 100 : 0}%` }} />
                     </div>
                   </div>
                   <div>
                     <div className="flex justify-between text-sm mb-1">
                       <span className="text-slate-400">{t('admin_status_active_subs')}</span>
                       <span className="font-bold text-blue-400">{totals.activeSubs}</span>
                     </div>
                   </div>
                 </div>
               </div>
             </div>

             <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
               <h3 className="text-sm font-semibold text-slate-300 mb-4">{t('admin_recent_apps')}</h3>
               <div className="space-y-2">
                 {recentApps.slice(0, 8).map((a: any) => {
                    // Controlla sia trial_ends_at che expires_at per la scadenza
                    const expiryDate = a.trial_ends_at || a.expires_at;
                    const expired = expiryDate && new Date(expiryDate) < new Date();
                   return (
                     <div key={a.id} className="flex items-center justify-between bg-slate-800 rounded-lg px-4 py-3">
                       <div>
                         <div className="font-medium text-sm">{a.name}</div>
                         <div className="text-xs text-slate-500">{new Date(a.created_at).toLocaleDateString('it-IT')}</div>
                       </div>
                       <div className="flex items-center gap-4">
                          {a.production_url ? (
                            <a href={a.production_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300">
                              {a.production_url}
                            </a>
                          ) : a.slug ? (
                            <a href={`/a/${a.slug}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300">
                              /a/{a.slug}
                            </a>
                          ) : null}
                         <span className={`text-xs font-medium ${expired ? 'text-red-400' : 'text-emerald-400'}`}>
                           {expired ? t('admin_status_expired_badge') : t('admin_status_active_badge')}
                         </span>
                       </div>
                     </div>
                   );
                 })}
                 {recentApps.length === 0 && <p className="text-slate-500 text-center py-4">{t('admin_no_apps')}</p>}
               </div>
             </div>
           </div>
         )}

         {/* RICAVI */}
         {tab === 'revenue' && (
           <div className="space-y-6">
             <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
               <KpiCard label={t('admin_kpi_revenue')} value={fmtEur(totals.revenue || 0)} color="from-emerald-600 to-emerald-700" />
               <KpiCard label={t('admin_kpi_estimated')} value={fmtEur(estimatedRevenue)} color="from-blue-600 to-blue-700" />
               <KpiCard label={t('admin_status_expired')} value={totals.expiredApps} color="from-red-600 to-red-700" />
             </div>

             <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
               <h3 className="text-sm font-semibold text-slate-300 mb-4">{t('admin_revenue_chart')}</h3>
               {chartData.length === 0 ? (
                 <div className="text-center py-12">
                   <p className="text-slate-500">{t('admin_no_payment_data')}</p>
                   <p className="text-slate-600 text-sm mt-2">{t('admin_payment_hint')}</p>
                 </div>
               ) : (
                 <ResponsiveContainer width="100%" height={300}>
                   <BarChart data={chartData}>
                     <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                     <XAxis dataKey="month" stroke="#64748b" fontSize={12} />
                     <YAxis stroke="#64748b" fontSize={12} />
                     <Tooltip
                       contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                       formatter={(v: any) => fmtEur(v)}
                     />
                     <Bar dataKey="revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
                   </BarChart>
                 </ResponsiveContainer>
               )}
             </div>

             <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
               <h3 className="text-sm font-semibold text-slate-300 mb-4">{t('admin_transactions')}</h3>
               {chartData.length === 0 ? (
                 <p className="text-slate-500 text-sm">{t('admin_chart_no_data')}</p>
               ) : (
                 <ResponsiveContainer width="100%" height={250}>
                   <BarChart data={chartData}>
                     <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                     <XAxis dataKey="month" stroke="#64748b" fontSize={12} />
                     <YAxis stroke="#64748b" fontSize={12} allowDecimals={false} />
                     <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} />
                     <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                   </BarChart>
                 </ResponsiveContainer>
               )}
             </div>
           </div>
         )}

         {/* PIANI */}
         {tab === 'plans' && (
           <div className="space-y-6">
             <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
               {Object.entries(dist).map(([plan, count]) => (
                 <div key={plan} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                   <div className="flex items-center gap-3 mb-3">
                     <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold" style={{ background: PLAN_COLORS[plan] || '#64748b' }}>
                       {plan.charAt(0).toUpperCase()}
                     </div>
                     <div>
                       <div className="text-xs text-slate-400 uppercase">{t('admin_plan_label')}</div>
                       <div className="text-lg font-bold">{plan}</div>
                     </div>
                   </div>
                   <div className="text-3xl font-bold">{count as number}</div>
                   <div className="text-xs text-slate-500 mt-1">
                     {fmtEur((count as number) * (PLAN_PRICES[plan] || 0))}{t('admin_estimated_per_month')}
                   </div>
                 </div>
               ))}
             </div>

             <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
               <h3 className="text-sm font-semibold text-slate-300 mb-4">{t('admin_chart_plan_dist')}</h3>
               <ResponsiveContainer width="100%" height={250}>
                 <BarChart data={Object.entries(dist).map(([name, value]) => ({ name, value: value as number }))}>
                   <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                   <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
                   <YAxis stroke="#64748b" fontSize={12} allowDecimals={false} />
                   <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} />
                   <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                     {Object.entries(dist).map(([name], i) => (
                       <Cell key={name} fill={PLAN_COLORS[name] || PIE_COLORS[i % PIE_COLORS.length]} />
                     ))}
                   </Bar>
                 </BarChart>
               </ResponsiveContainer>
             </div>
           </div>
         )}

         {/* APP */}
         {tab === 'apps' && (
           <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
             <div className="p-5 border-b border-slate-800">
               <h3 className="text-sm font-semibold text-slate-300">{t('admin_all_apps')} ({totals.apps})</h3>
             </div>
             <div className="overflow-x-auto">
               <table className="w-full text-sm">
                 <thead className="bg-slate-800">
                   <tr>
                     <th className="px-5 py-3 text-left font-semibold text-slate-300">{t('admin_table_name')}</th>
                     <th className="px-5 py-3 text-left font-semibold text-slate-300">{t('admin_table_status')}</th>
                     <th className="px-5 py-3 text-left font-semibold text-slate-300">{t('admin_table_expiry')}</th>
                     <th className="px-5 py-3 text-left font-semibold text-slate-300">{t('admin_table_created')}</th>
                     <th className="px-5 py-3 text-left font-semibold text-slate-300">{t('admin_table_link')}</th>
                     <th className="px-5 py-3 text-left font-semibold text-slate-300">{t('admin_table_actions')}</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-800">
                   {recentApps.map((a: any) => {
                      // Controlla sia trial_ends_at che expires_at per la scadenza
                      const expiryDate = a.trial_ends_at || a.expires_at;
                      const expired = expiryDate && new Date(expiryDate) < new Date();
                      const isOwnedByAdmin = a.ownership_status === 'admin_owned';
                      return (
                        <tr key={a.id} className="hover:bg-slate-800/50">
                          <td className="px-5 py-3 font-medium">{a.name}</td>
                          <td className="px-5 py-3">
                            {expired ? (
                              <span className="px-2 py-1 rounded text-xs font-medium bg-red-600/20 text-red-400">{t('admin_status_expired_badge')}</span>
                            ) : isOwnedByAdmin ? (
                              <span className="px-2 py-1 rounded text-xs font-medium bg-orange-600/20 text-orange-400">{t('admin_status_admin_owned')}</span>
                            ) : (
                              <span className="px-2 py-1 rounded text-xs font-medium bg-emerald-600/20 text-emerald-400">{t('admin_status_active_badge')}</span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-slate-400">{expiryDate ? new Date(expiryDate).toLocaleDateString('it-IT') : '-'}</td>
                         <td className="px-5 py-3 text-slate-400">{new Date(a.created_at).toLocaleDateString('it-IT')}</td>
                         <td className="px-5 py-3">
                          {a.production_url ? (
                            <a href={a.production_url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 text-xs">
                              {a.production_url}
                            </a>
                          ) : a.slug ? (
                            <a href={`/a/${a.slug}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 text-xs">
                              /a/{a.slug}
                            </a>
                          ) : null}
                         </td>
                         <td className="px-5 py-3">
                           {!isOwnedByAdmin && (
                             <button
                               onClick={() => setTakeoverModal({ isOpen: true, appId: a.id, appName: a.name })}
                               disabled={takeoverLoading}
                               className="px-3 py-1 bg-orange-600/20 text-orange-400 rounded hover:bg-orange-600/30 text-xs font-medium disabled:opacity-50"
                             >
                               {t('admin_takeover_button')}
                             </button>
                           )}
                         </td>
                       </tr>
                     );
                   })}
           {recentApps.length === 0 && <tr><td colSpan={6} className="px-5 py-12 text-center text-slate-500">{t('admin_no_apps')}</td></tr>}
                 </tbody>
               </table>
             </div>
           </div>
         )}

         {/* Takeover Modal */}
         <TakeoverModal
           isOpen={takeoverModal.isOpen}
           appName={takeoverModal.appName}
           onClose={() => setTakeoverModal({ isOpen: false, appId: null, appName: '' })}
           onConfirm={() => takeoverModal.appId && executeTakeover(takeoverModal.appId)}
         />

         {/* DEBITI RIVENDITORI */}
         {tab === 'debts' && (
           <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
             <div className="p-5 border-b border-slate-800">
               <h3 className="text-sm font-semibold text-slate-300">{t('admin_tab_debts')}</h3>
             </div>
             {debtsLoading ? (
               <div className="p-6 text-center">
                 <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                 <p className="text-slate-400 mt-2">{t('admin_loading')}</p>
               </div>
             ) : (
               <div className="overflow-x-auto">
                 <table className="w-full text-sm">
                   <thead className="bg-slate-800">
                     <tr>
                       <th className="px-5 py-3 text-left font-semibold text-slate-300">{t('admin_debt_reseller')}</th>
                       <th className="px-5 py-3 text-left font-semibold text-slate-300">{t('admin_debt_email')}</th>
                       <th className="px-5 py-3 text-left font-semibold text-slate-300">{t('admin_debt_amount')}</th>
                       <th className="px-5 py-3 text-left font-semibold text-slate-300">{t('admin_debt_transactions')}</th>
                       <th className="px-5 py-3 text-left font-semibold text-slate-300">{t('admin_debt_actions')}</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-slate-800">
                     {resellerDebts.map((debt: any) => (
                       <tr key={debt.reseller_id} className="hover:bg-slate-800/50">
                         <td className="px-5 py-3 font-medium">{debt.reseller_name || t('admin_debt_unknown')}</td>
                         <td className="px-5 py-3 text-slate-400">{debt.reseller_email}</td>
                         <td className="px-5 py-3">
                           <span className="font-bold text-red-400">
                             {fmtEur(debt.total_debt || 0)}
                           </span>
                         </td>
                         <td className="px-5 py-3 text-slate-400">{debt.pending_transactions_count}</td>
                         <td className="px-5 py-3">
                           <button
                             onClick={() => markAsPaid(debt.reseller_id)}
                             className="px-3 py-1 bg-emerald-600/20 text-emerald-400 rounded hover:bg-emerald-600/30 text-xs font-medium"
                           >
                             {t('admin_debt_mark_paid')}
                           </button>
                         </td>
                       </tr>
                     ))}
                     {resellerDebts.length === 0 && (
                       <tr>
                         <td colSpan={5} className="px-5 py-12 text-center text-slate-500">
                           {t('admin_debt_no_debts')}
                         </td>
                       </tr>
                     )}
                   </tbody>
                 </table>
               </div>
             )}
           </div>
         )}
       </div>
     </div>
   );
}
