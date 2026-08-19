'use client';

// ─── Admin: Candidature Private Beta — Pre-Beta Hardening, Blocco 4 ────────
// Dashboard minima (nessun CRM, nessuna UI complessa, come da scope): elenco,
// filtro per status, cambio status. Protetta dal guard già esistente in
// app/admin/layout.tsx (redirect a /login o /dashboard se non admin) più
// l'autorizzazione server-side indipendente delle due route sotto
// (api/admin/beta-applications) — nessuna delle due da sola basta, entrambe
// enforced. Nessuna i18n (t()): pagina interna, mai vista da un cliente,
// stesso principio già in uso per /a/[slug]/settings/api-docs.

import { Fragment, useEffect, useState, useCallback } from 'react';
import { supabaseBrowser } from '@/src/lib/supabase-browser';

type Status = 'new' | 'reviewing' | 'approved' | 'rejected' | 'contacted';

interface BetaApplication {
  id: string;
  full_name: string;
  company_name: string;
  email: string;
  website: string | null;
  country: string;
  business_type: string;
  client_count: string;
  app_types: string;
  expected_apps: string;
  message: string | null;
  status: Status;
  created_at: string;
  updated_at: string;
}

const STATUS_OPTIONS: Status[] = ['new', 'reviewing', 'approved', 'rejected', 'contacted'];

const STATUS_LABELS: Record<Status, string> = {
  new: 'Nuova',
  reviewing: 'In revisione',
  approved: 'Approvata',
  rejected: 'Rifiutata',
  contacted: 'Contattata',
};

const STATUS_COLORS: Record<Status, string> = {
  new: 'bg-slate-700 text-slate-200',
  reviewing: 'bg-amber-900/60 text-amber-300',
  approved: 'bg-emerald-900/60 text-emerald-300',
  rejected: 'bg-red-900/60 text-red-300',
  contacted: 'bg-indigo-900/60 text-indigo-300',
};

export default function AdminBetaApplicationsPage() {
  const [applications, setApplications] = useState<BetaApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async (filter: Status | 'all') => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) {
        setError('Sessione non valida, effettua di nuovo il login.');
        setLoading(false);
        return;
      }
      const qs = filter !== 'all' ? `?status=${filter}` : '';
      const res = await fetch(`/api/admin/beta-applications${qs}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || 'Errore caricando le candidature.');
        setApplications([]);
      } else {
        setApplications(body.applications || []);
      }
    } catch {
      setError('Errore di rete caricando le candidature.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // queueMicrotask: load() aggiorna lo stato (setLoading/setApplications)
    // già nella sua prima riga sincrona — chiamarlo direttamente nel corpo
    // dell'effect innescherebbe un setState sincrono durante il commit
    // dell'effect stesso (react-hooks/set-state-in-effect). Il differimento
    // a microtask è immediato dal punto di vista dell'utente, cambia solo
    // in quale fase React osserva l'aggiornamento di stato.
    queueMicrotask(() => { load(statusFilter); });
  }, [statusFilter, load]);

  async function changeStatus(id: string, status: Status) {
    setUpdatingId(id);
    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) return;
      const res = await fetch(`/api/admin/beta-applications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setApplications((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
      }
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Candidature Private Beta</h1>
        <p className="text-slate-400 text-sm mt-1">
          Revisiona le richieste ricevute dal form pubblico /beta e aggiornane lo stato.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        <button
          onClick={() => setStatusFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
            statusFilter === 'all' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          Tutte
        </button>
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              statusFilter === s ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {loading && <p className="text-slate-400">Caricamento…</p>}
      {error && <p className="text-red-400 mb-4">{error}</p>}

      {!loading && !error && applications.length === 0 && (
        <p className="text-slate-500">Nessuna candidatura{statusFilter !== 'all' ? ` con status "${STATUS_LABELS[statusFilter]}"` : ''}.</p>
      )}

      {!loading && applications.length > 0 && (
        <div className="border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 text-left text-xs uppercase text-slate-500">
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Azienda</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Paese</th>
                <th className="px-4 py-3 font-medium">Data</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((app) => (
                <Fragment key={app.id}>
                  <tr className="border-t border-slate-800 hover:bg-slate-900/50">
                    <td className="px-4 py-3 text-white">{app.full_name}</td>
                    <td className="px-4 py-3 text-slate-300">{app.company_name}</td>
                    <td className="px-4 py-3 text-slate-300">
                      <a href={`mailto:${app.email}`} className="hover:text-indigo-400">{app.email}</a>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{app.country}</td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                      {new Date(app.created_at).toLocaleDateString('it-IT', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${STATUS_COLORS[app.status]}`}>
                        {STATUS_LABELS[app.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <select
                          value={app.status}
                          disabled={updatingId === app.id}
                          onChange={(e) => changeStatus(app.id, e.target.value as Status)}
                          className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white disabled:opacity-50"
                        >
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => setExpandedId(expandedId === app.id ? null : app.id)}
                          className="text-xs text-slate-400 hover:text-white underline"
                        >
                          {expandedId === app.id ? 'chiudi' : 'dettagli'}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedId === app.id && (
                    <tr className="border-t border-slate-800 bg-slate-900/40">
                      <td colSpan={7} className="px-4 py-4 text-slate-300 text-sm">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                          <div><span className="text-slate-500">Sito:</span> {app.website || '—'}</div>
                          <div><span className="text-slate-500">Tipo attività:</span> {app.business_type}</div>
                          <div><span className="text-slate-500">Clienti:</span> {app.client_count}</div>
                          <div><span className="text-slate-500">App previste:</span> {app.expected_apps}</div>
                        </div>
                        <div className="mb-2"><span className="text-slate-500">Tipi di app:</span> {app.app_types}</div>
                        {app.message && <div><span className="text-slate-500">Messaggio:</span> {app.message}</div>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
