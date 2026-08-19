'use client';

// ─── ActionLogsSection ──────────────────────────────────────────────────────
// Viewer minimo di app_action_logs (Pre-Beta Hardening, Blocco 8): prima di
// questa sezione l'audit trail delle azioni/webhook/notifiche esisteva solo
// nel database, mai consultabile senza una query SQL manuale. Sola lettura,
// ultime 50 righe, nessun filtro/paginazione — "viewer minimo", non un
// pannello Log Azioni completo. Stesso stile/pattern (authHeader via sessione
// Supabase) delle altre schede di questa pagina, vedi DataApiSection.tsx.

import { useCallback, useEffect, useState } from 'react';
import { ListChecks, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/src/lib/supabase';

interface ActionLogRow {
  id: string;
  entity: string | null;
  action_id: string | null;
  action_type: string | null;
  status: 'dispatched' | 'delivered' | 'failed' | string;
  error: string | null;
  workflow_id: string | null;
  event_type: string | null;
  actor_role: string | null;
  actor_email: string | null;
  retry_count: number | null;
  created_at: string;
}

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    delivered: 'bg-green-500/20 text-green-400',
    dispatched: 'bg-blue-500/20 text-blue-400',
    failed: 'bg-red-500/20 text-red-400',
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[status] || 'bg-slate-500/20 text-slate-400'}`}>{status}</span>;
}

export default function ActionLogsSection({ appId }: { appId: string }) {
  const [logs, setLogs] = useState<ActionLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    if (!appId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/${appId}/action-logs`, { headers: await authHeader() });
      const data = await res.json();
      if (res.ok) {
        setLogs(data.logs || []);
      } else {
        setError(data.error || 'Errore caricamento log');
      }
    } catch {
      setError('Errore di connessione');
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    queueMicrotask(() => { loadLogs(); });
  }, [loadLogs]);

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ListChecks size={20} className="text-slate-400" />
          <h3 className="text-lg font-semibold text-white">Log Azioni</h3>
        </div>
        <button
          onClick={() => loadLogs()}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Aggiorna
        </button>
      </div>
      <p className="text-slate-500 text-sm mb-4">
        Ultime {logs.length > 0 ? logs.length : ''} azioni eseguite su questa app: webhook, notifiche, automazioni.
      </p>

      {loading && (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
          <Loader2 size={16} className="animate-spin" /> Caricamento…
        </div>
      )}
      {error && <p className="text-red-400 text-sm py-2">{error}</p>}

      {!loading && !error && logs.length === 0 && (
        <p className="text-slate-500 text-sm py-4">Nessuna azione registrata finora.</p>
      )}

      {!loading && logs.length > 0 && (
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-500 border-b border-slate-800">
                <th className="px-2 py-2 font-medium">Data</th>
                <th className="px-2 py-2 font-medium">Entità</th>
                <th className="px-2 py-2 font-medium">Azione</th>
                <th className="px-2 py-2 font-medium">Stato</th>
                <th className="px-2 py-2 font-medium">Dettaglio</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-slate-800/50">
                  <td className="px-2 py-2 text-slate-400 whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-2 py-2 text-slate-300">{log.entity || '—'}</td>
                  <td className="px-2 py-2 text-slate-300">
                    {log.action_type || '—'}
                    {log.workflow_id && <span className="text-slate-500 text-xs ml-1">(automazione)</span>}
                  </td>
                  <td className="px-2 py-2">{statusBadge(log.status)}</td>
                  <td className="px-2 py-2 text-slate-500 text-xs max-w-xs truncate" title={log.error || undefined}>
                    {log.error || (log.retry_count ? `${log.retry_count} retry` : '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
