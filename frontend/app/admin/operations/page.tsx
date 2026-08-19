'use client';

// ─── Admin: Operations — Round 2 ────────────────────────────────────────────
// Dashboard minima in sola lettura (nessuna azione, nessun CRM/DevOps
// esteso, come da scope): ultimo esito per job schedulato, storico corto
// delle esecuzioni recenti, consumo AI aggregato, stato dei canali di
// alerting. Protetta dal guard già esistente in app/admin/layout.tsx più
// l'autorizzazione server-side indipendente di /api/admin/operations —
// stesso doppio livello già in uso da app/admin/beta/page.tsx.

import { useEffect, useState, useCallback } from 'react';
import { supabaseBrowser } from '@/src/lib/supabase-browser';

interface CronJobRunRow {
  job_name: string;
  run_key: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'ok' | 'failed';
  error: string | null;
}

interface OperationsData {
  cronJobsMigrationApplied: boolean;
  jobs: { jobName: string; lastRun: CronJobRunRow | null }[];
  recentRuns: CronJobRunRow[];
  aiUsage: {
    migrationApplied: boolean;
    last24hCostUsd: number | null;
    last24hCalls: number | null;
    last30dCostUsd: number | null;
    last30dCalls: number | null;
  };
  alerting: { emailConfigured: boolean; webhookConfigured: boolean };
}

const JOB_LABELS: Record<string, string> = {
  'expiry-check': 'Controllo scadenze abbonamenti',
  'workflow-tick': 'Motore automazioni (tick)',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function durationLabel(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return 'in corso…';
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StatusBadge({ status }: { status: 'running' | 'ok' | 'failed' | 'never' }) {
  const styles: Record<string, string> = {
    ok: 'bg-emerald-900/60 text-emerald-300',
    failed: 'bg-red-900/60 text-red-300',
    running: 'bg-amber-900/60 text-amber-300',
    never: 'bg-slate-800 text-slate-500',
  };
  const labels: Record<string, string> = { ok: 'OK', failed: 'Fallito', running: 'In corso', never: 'Mai eseguito' };
  return <span className={`px-2 py-1 rounded text-xs font-semibold ${styles[status]}`}>{labels[status]}</span>;
}

function fmtUsd(n: number | null): string {
  if (n === null) return '—';
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

export default function AdminOperationsPage() {
  const [data, setData] = useState<OperationsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) {
        setError('Sessione non valida, effettua di nuovo il login.');
        setLoading(false);
        return;
      }
      const res = await fetch('/api/admin/operations', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || 'Errore caricando lo stato operativo.');
      } else {
        setData(body);
      }
    } catch {
      setError('Errore di rete caricando lo stato operativo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => { load(); });
  }, [load]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Operations</h1>
          <p className="text-slate-400 text-sm mt-1">
            Stato dei job schedulati, consumo AI e canali di alerting — sola lettura.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-800 text-slate-300 hover:text-white transition disabled:opacity-50"
        >
          {loading ? 'Aggiorno…' : 'Aggiorna'}
        </button>
      </div>

      {loading && !data && <p className="text-slate-400">Caricamento…</p>}
      {error && <p className="text-red-400">{error}</p>}

      {data && (
        <>
          {!data.cronJobsMigrationApplied && (
            <div className="border border-amber-800/60 bg-amber-950/30 text-amber-300 rounded-xl p-4 text-sm">
              La tabella cron_job_runs non è raggiungibile su questo ambiente: i job potrebbero comunque star girando (fail-open by design), ma questa dashboard non può mostrarne lo storico.
            </div>
          )}

          {/* ─── Job schedulati ────────────────────────────────────────── */}
          <section>
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Job schedulati</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {data.jobs.map(({ jobName, lastRun }) => (
                <div key={jobName} className="border border-slate-800 rounded-xl p-4 bg-slate-900/40">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-white font-semibold text-sm">{JOB_LABELS[jobName] || jobName}</h3>
                    <StatusBadge status={lastRun ? lastRun.status : 'never'} />
                  </div>
                  <p className="text-xs text-slate-500 mb-1">{jobName}</p>
                  {lastRun ? (
                    <div className="text-xs text-slate-400 space-y-1">
                      <p>Ultimo avvio: {fmtDate(lastRun.started_at)}</p>
                      <p>Durata: {durationLabel(lastRun.started_at, lastRun.finished_at)}</p>
                      {lastRun.error && (
                        <p className="text-red-400 mt-2 break-words">Errore: {lastRun.error}</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">Nessuna esecuzione registrata finora.</p>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* ─── Consumo AI ────────────────────────────────────────────── */}
          <section>
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Consumo AI (tutti i tenant)</h2>
            {!data.aiUsage.migrationApplied ? (
              <p className="text-slate-500 text-sm">Tabella ai_usage non raggiungibile su questo ambiente.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/40">
                  <p className="text-xs text-slate-500 mb-1">Spesa 24h</p>
                  <p className="text-xl font-bold text-white">{fmtUsd(data.aiUsage.last24hCostUsd)}</p>
                </div>
                <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/40">
                  <p className="text-xs text-slate-500 mb-1">Chiamate 24h</p>
                  <p className="text-xl font-bold text-white">{data.aiUsage.last24hCalls ?? '—'}</p>
                </div>
                <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/40">
                  <p className="text-xs text-slate-500 mb-1">Spesa 30gg</p>
                  <p className="text-xl font-bold text-white">{fmtUsd(data.aiUsage.last30dCostUsd)}</p>
                </div>
                <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/40">
                  <p className="text-xs text-slate-500 mb-1">Chiamate 30gg</p>
                  <p className="text-xl font-bold text-white">{data.aiUsage.last30dCalls ?? '—'}</p>
                </div>
              </div>
            )}
          </section>

          {/* ─── Alerting ──────────────────────────────────────────────── */}
          <section>
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Canali di alerting</h2>
            <div className="flex gap-4">
              <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/40 flex items-center gap-3">
                <StatusBadge status={data.alerting.emailConfigured ? 'ok' : 'never'} />
                <span className="text-sm text-slate-300">Email (Resend)</span>
              </div>
              <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/40 flex items-center gap-3">
                <StatusBadge status={data.alerting.webhookConfigured ? 'ok' : 'never'} />
                <span className="text-sm text-slate-300">Webhook (Slack/Discord/altro)</span>
              </div>
            </div>
          </section>

          {/* ─── Storico esecuzioni recenti ────────────────────────────── */}
          {data.recentRuns.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Ultime esecuzioni</h2>
              <div className="border border-slate-800 rounded-xl overflow-hidden overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-900 text-left text-xs uppercase text-slate-500">
                      <th className="px-4 py-2 font-medium">Job</th>
                      <th className="px-4 py-2 font-medium">Finestra</th>
                      <th className="px-4 py-2 font-medium">Avvio</th>
                      <th className="px-4 py-2 font-medium">Durata</th>
                      <th className="px-4 py-2 font-medium">Stato</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentRuns.map((r) => (
                      <tr key={`${r.job_name}-${r.run_key}`} className="border-t border-slate-800">
                        <td className="px-4 py-2 text-slate-300 whitespace-nowrap">{JOB_LABELS[r.job_name] || r.job_name}</td>
                        <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{r.run_key}</td>
                        <td className="px-4 py-2 text-slate-400 whitespace-nowrap">{fmtDate(r.started_at)}</td>
                        <td className="px-4 py-2 text-slate-400 whitespace-nowrap">{durationLabel(r.started_at, r.finished_at)}</td>
                        <td className="px-4 py-2"><StatusBadge status={r.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
