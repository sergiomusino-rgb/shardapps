'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/src/lib/supabase';
import { sanitizeBlueprint } from '@/src/lib/blueprint-schema';
import Link from 'next/link';

export default function AppViewerPage() {
  const params = useParams();
  const router = useRouter();
  const appId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [blueprint, setBlueprint] = useState<any>(null);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [records, setRecords] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingRecord, setEditingRecord] = useState<any>(null);

  useEffect(() => {
    loadApp();
  }, [appId]);

  useEffect(() => {
    if (selectedTable && blueprint) {
      loadRecords(selectedTable);
    }
  }, [selectedTable]);

  async function loadApp() {
    try {
      // Cast mirato: il client `supabase` (src/lib/supabase.ts) non ha un
      // generic Database, quindi supabase-js risolve qui a `never` come
      // altrove nel progetto (vedi audit tsc).
      const { data: appDataRaw, error } = await supabase
        .from('apps' as any)
        .select('id, name, config, blueprint_id')
        .eq('id', appId)
        .single();
      const appData = appDataRaw as { id: string; name: string; config: Record<string, unknown>; blueprint_id: string | null } | null;

      if (error || !appData) {
        console.error('App not found:', error);
        router.push('/dashboard/projects');
        return;
      }

      console.log('[AppViewer] Raw config from DB:', JSON.stringify(appData.config));
      console.log('[AppViewer] Config keys:', Object.keys(appData.config || {}));

      // Il blueprint è salvato in app.config
      const sanitized = sanitizeBlueprint(appData.config);
      console.log('[AppViewer] Sanitized blueprint:', sanitized);
      console.log('[AppViewer] Tables count:', sanitized?.schema?.tables?.length || 0);

      if (!sanitized) {
        console.error('[AppViewer] sanitizeBlueprint returned null for config:', appData.config);
      }
      
      setBlueprint(sanitized);

      // Seleziona prima tabella di default
      if (sanitized?.schema?.tables?.[0]) {
        setSelectedTable(sanitized.schema.tables[0].name);
      }
    } catch (err) {
      console.error('Load app error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadRecords(tableName: string) {
    try {
      const token = await getAuthToken();
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/apps/${appId}/records?table=${tableName}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setRecords(data.records || []);
    } catch (err) {
      console.error('Load records error:', err);
    }
  }

  async function getAuthToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || '';
  }

  async function handleDeleteRecord(recordId: string) {
    if (!confirm('Eliminare questo record?')) return;

    try {
      const token = await getAuthToken();
      await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/apps/${appId}/records/${recordId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      loadRecords(selectedTable);
    } catch (err) {
      console.error('Delete error:', err);
    }
  }

  function handleEditRecord(record: any) {
    setEditingRecord(record);
    setShowForm(true);
  }

  async function handleExport() {
    try {
      const token = await getAuthToken();
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/apps/${appId}/export?table=${selectedTable}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (!res.ok) throw new Error('Export fallito');
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedTable}-export.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
      alert('Errore durante l\'esportazione');
    }
  }

  async function handleImport(file: File) {
    try {
      const token = await getAuthToken();
      const formData = new FormData();
      formData.append('file', file);
      formData.append('table', selectedTable);

      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/apps/${appId}/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) throw new Error('Import fallito');

      const data = await res.json();
      alert(`${data.imported} record importati con successo`);
      loadRecords(selectedTable);
    } catch (err) {
      console.error('Import error:', err);
      alert('Errore durante l\'importazione');
    }
  }

  function handleNewRecord() {
    setEditingRecord(null);
    setShowForm(true);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="text-xl">Caricamento...</div>
      </div>
    );
  }

  if (!blueprint) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="text-xl">App non trovata</div>
      </div>
    );
  }

  const currentTable = blueprint.schema?.tables?.find((t: any) => t.name === selectedTable);

  return (
    <div className="min-h-screen bg-gray-950 text-white flex">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 border-r border-gray-800 p-6">
        <Link href="/dashboard/projects" className="text-gray-400 hover:text-white mb-4 block">
          ← Torna ai Progetti
        </Link>
        {blueprint.logo && (
          <img src={blueprint.logo} alt="Logo" className="w-16 h-16 rounded-lg mb-3 object-contain" />
        )}
        <h1 className="text-2xl font-bold mb-2">{blueprint.appName}</h1>
        <p className="text-sm text-gray-400 mb-8">{blueprint.description}</p>

        <nav className="space-y-2">
          {blueprint.schema?.tables?.map((table: any) => (
            <button
              key={table.name}
              onClick={() => setSelectedTable(table.name)}
              className={`w-full text-left px-4 py-2 rounded-lg transition ${
                selectedTable === table.name
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800'
              }`}
            >
              {table.icon && <span className="mr-2">{table.icon}</span>}
              {table.labelPlural || table.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-3xl font-bold">
              {currentTable?.icon && <span className="mr-3">{currentTable.icon}</span>}
              {currentTable?.labelPlural || currentTable?.label}
            </h2>
            <div className="flex gap-3">
              <button
                onClick={() => handleExport()}
                className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 rounded-lg font-semibold transition"
              >
                Esporta CSV
              </button>
              <button
                onClick={() => setShowImport(true)}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition"
              >
                Importa CSV
              </button>
              <button
                onClick={handleNewRecord}
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 rounded-lg font-semibold transition"
              >
                + Nuovo
              </button>
            </div>
          </div>

          {/* Records Table */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-800">
                <tr>
                  {currentTable?.fields?.map((field: any) => (
                    <th key={field.id} className="px-4 py-3 text-left text-sm font-semibold text-gray-300">
                      {field.label}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-300">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={(currentTable?.fields?.length || 0) + 1} className="px-4 py-12 text-center text-gray-500">
                      Nessun record. Clicca &quot;+ Nuovo&quot; per crearne uno.
                    </td>
                  </tr>
                ) : (
                  records.map((record: any) => (
                    <tr key={record.id} className="border-t border-gray-800 hover:bg-gray-800/50">
                      {currentTable?.fields?.map((field: any) => (
                        <td key={field.id} className="px-4 py-3 text-sm text-gray-300">
                          {renderFieldValue(record.data[field.id], field)}
                        </td>
                      ))}
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleEditRecord(record)}
                          className="text-blue-400 hover:text-blue-300 mr-4"
                        >
                          Modifica
                        </button>
                        <button
                          onClick={() => handleDeleteRecord(record.id)}
                          className="text-red-400 hover:text-red-300"
                        >
                          Elimina
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Record Count */}
          <div className="mt-4 text-sm text-gray-500">
            {records.length} record{records.length !== 1 ? 'i' : 'o'}
          </div>
        </div>
      </main>

      {/* Form Modal */}
      {showForm && currentTable && (
        <RecordFormModal
          table={currentTable}
          record={editingRecord}
          appId={appId}
          onClose={() => setShowForm(false)}
          onSave={() => {
            setShowForm(false);
            loadRecords(selectedTable);
          }}
        />
      )}

      {/* Import Modal */}
      {showImport && (
        <ImportModal
          tableName={currentTable?.labelPlural || currentTable?.label}
          onImport={handleImport}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  );
}

function ImportModal({ tableName, onImport, onClose }: { tableName: string; onImport: (file: File) => void; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (file) {
      onImport(file);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-xl border border-gray-800 max-w-md w-full">
        <div className="p-6 border-b border-gray-800">
          <h3 className="text-2xl font-bold">Importa CSV in {tableName}</h3>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Seleziona file CSV o Excel
            </label>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:border-indigo-500 focus:outline-none"
            />
            <p className="text-xs text-gray-500 mt-2">
              Il file deve avere le intestazioni corrispondenti ai campi della tabella. Supportati: CSV, Excel (.xlsx, .xls).
            </p>
          </div>

          <div className="flex gap-4 pt-4">
            <button
              type="submit"
              disabled={!file}
              className="flex-1 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 rounded-lg font-semibold transition"
            >
              Importa
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg font-semibold transition"
            >
              Annulla
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function renderFieldValue(value: any, field: any) {
  if (value == null || value === '') return <span className="text-gray-600">—</span>;

  switch (field.type) {
    case 'currency':
      return `€${parseFloat(value).toFixed(2)}`;
    case 'boolean':
      return value ? '✓' : '✗';
    case 'date':
    case 'datetime':
      return new Date(value).toLocaleDateString('it-IT');
    default:
      return String(value);
  }
}

function RecordFormModal({ table, record, appId, onClose, onSave }: any) {
  const [formData, setFormData] = useState<Record<string, any>>(
    record ? record.data : {}
  );
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      const url = record
        ? `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/apps/${appId}/records/${record.id}`
        : `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/apps/${appId}/records`;

      const method = record ? 'PUT' : 'POST';
      const body = record
        ? { data: formData }
        : { table: table.name, data: formData };

      await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      onSave();
    } catch (err) {
      console.error('Save error:', err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-xl border border-gray-800 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-800">
          <h3 className="text-2xl font-bold">
            {record ? 'Modifica Record' : `Nuovo ${table.label}`}
          </h3>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {table.fields?.map((field: any) => (
            <div key={field.id}>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {field.label}
                {field.required && <span className="text-red-400 ml-1">*</span>}
              </label>
              {renderFormField(field, formData[field.id] || '', (val) =>
                setFormData({ ...formData, [field.id]: val })
              )}
            </div>
          ))}

          <div className="flex gap-4 pt-4">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 rounded-lg font-semibold transition"
            >
              {saving ? 'Salvataggio...' : 'Salva'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg font-semibold transition"
            >
              Annulla
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function renderFormField(field: any, value: any, onChange: (val: any) => void) {
  switch (field.type) {
    case 'textarea':
      return (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:border-indigo-500 focus:outline-none"
        />
      );
    case 'select':
      return (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:border-indigo-500 focus:outline-none"
        >
          <option value="">Seleziona...</option>
          {field.options?.map((opt: any) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    case 'boolean':
      return (
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={value === true || value === 'true'}
            onChange={(e) => onChange(e.target.checked)}
            className="w-5 h-5 rounded bg-gray-800 border-gray-700 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="ml-2 text-gray-300">Attivo</span>
        </label>
      );
    case 'number':
    case 'currency':
      return (
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          step={field.type === 'currency' ? '0.01' : '1'}
          className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:border-indigo-500 focus:outline-none"
        />
      );
    case 'date':
      return (
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:border-indigo-500 focus:outline-none"
        />
      );
    case 'datetime':
      return (
        <input
          type="datetime-local"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:border-indigo-500 focus:outline-none"
        />
      );
    case 'email':
      return (
        <input
          type="email"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:border-indigo-500 focus:outline-none"
        />
      );
    case 'phone':
      return (
        <input
          type="tel"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:border-indigo-500 focus:outline-none"
        />
      );
    default:
      return (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:border-indigo-500 focus:outline-none"
        />
      );
  }
}
