'use client';

// ─── CollectedDataSection ───────────────────────────────────────────────────
// Scheda "Dati Raccolti": datagrid di sola lettura sulle tabelle Supabase
// generate dall'app (es. Lead, Ordini, Prenotazioni) con esportazione CSV.
// Legge da /api/apps/[id]/records (owner-side, service role) invece che dal
// backend Express usato da DynamicTable dentro l'app: qui il proprietario
// osserva i dati del cliente, non li modifica, e non ha il client_password/JWT
// necessario per l'auth_mode dell'app cliente.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Loader2, Table as TableIcon } from 'lucide-react';
import { supabase } from '@/src/lib/supabase';

interface FieldDef {
  id?: string;
  name?: string;
  label: string;
  type: string;
}

interface TableDef {
  name: string;
  label: string;
  labelPlural: string;
  icon?: string;
  fields: FieldDef[];
}

interface AppRecordRow {
  id: string;
  table_name: string;
  data: Record<string, unknown> | null;
  created_at: string;
}

function fieldKey(f: FieldDef): string {
  return f.id || f.name || '';
}

function toCsvValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map(toCsvValue).join(',')).join('\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CollectedDataSection({ appId, tables }: { appId: string; tables: TableDef[] }) {
  const [selectedTable, setSelectedTable] = useState<string>(tables[0]?.name || '');
  const [records, setRecords] = useState<AppRecordRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeTable = useMemo(
    () => tables.find((t) => t.name === selectedTable) || null,
    [tables, selectedTable]
  );

  const loadRecords = useCallback(async () => {
    if (!appId || !selectedTable) return;
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/apps/${appId}/records?table=${encodeURIComponent(selectedTable)}`, {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Errore caricamento dati');
      setRecords(data.records || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore caricamento dati');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [appId, selectedTable]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const handleExport = () => {
    if (!activeTable) return;
    const header = activeTable.fields.map((f) => f.label);
    const rows = records.map((r) => activeTable.fields.map((f) => (r.data?.[fieldKey(f)] as unknown) ?? ''));
    downloadCsv(`${activeTable.name}-${new Date().toISOString().split('T')[0]}.csv`, [header, ...rows.map((r) => r.map(String))]);
  };

  if (tables.length === 0) return null;

  return (
    <div className="bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-6 mb-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <TableIcon className="w-5 h-5 text-violet-400" />
          Dati Raccolti
        </h2>
        <button
          onClick={handleExport}
          disabled={records.length === 0}
          className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-gray-300 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download size={15} />
          Esporta CSV
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {tables.map((t) => (
          <button
            key={t.name}
            onClick={() => setSelectedTable(t.name)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              selectedTable === t.name
                ? 'bg-violet-600 text-white'
                : 'bg-slate-800 text-gray-400 hover:text-white'
            }`}
          >
            {t.icon} {t.labelPlural}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Caricamento...
        </div>
      ) : error ? (
        <p className="py-6 text-center text-sm text-red-400">{error}</p>
      ) : !activeTable || records.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">Nessun dato raccolto per questa tabella.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-800/60">
                {activeTable.fields.map((f) => (
                  <th key={fieldKey(f)} className="whitespace-nowrap px-4 py-2 text-left font-semibold text-gray-400">
                    {f.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="border-t border-slate-800">
                  {activeTable.fields.map((f) => (
                    <td key={fieldKey(f)} className="max-w-[200px] truncate whitespace-nowrap px-4 py-2 text-gray-200">
                      {String(r.data?.[fieldKey(f)] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
