'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  X,
  ChevronDown,
  Download,
  Upload,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// Type Definitions
// ═══════════════════════════════════════════════════════════════════════════

export interface FieldDef {
  name?: string;
  id?: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'dropdown' | 'checkbox' | 'boolean' | 'number' | 'currency' | 'date' | 'datetime' | 'email' | 'phone' | 'tel' | 'relation';
  options?: string[];
  required?: boolean;
  placeholder?: string;
  target?: string;
  targetLabel?: string;
}

export interface TableDef {
  name: string;
  label: string;
  labelPlural: string;
  icon?: string;
  fields: FieldDef[];
}

export interface AppRecord {
  id: string;
  app_id?: string;
  tenant_id?: string;
  table_name?: string;
  data: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface DynamicTableProps {
  /** Definizione della tabella (schema con campi) */
  table: TableDef;

  /** ID dell'app per filtrare i record */
  appId: string;

  /** Supabase URL (opzionale, usa env var se non fornito) */
  supabaseUrl?: string;

  /** Supabase Anon Key (opzionale, usa env var se non fornito) */
  supabaseAnonKey?: string;

  /** Callback quando un record viene modificato/creato/cancellato */
  onRecordsChanged?: () => void;

  /** Numero di record per pagina (default 15) */
  pageSize?: number;

  /** Record esterni (se forniti, non esegue il fetch interno) */
  records?: AppRecord[];

  /** Loading state esterno */
  loading?: boolean;

  /** Errore esterno */
  error?: string | null;

  /** Classi aggiuntive per il container */
  className?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Form Modal Component (Inline)
// ═══════════════════════════════════════════════════════════════════════════

interface RecordModalProps {
  table: TableDef;
  record: AppRecord | null; // null = new record
  onSave: (data: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
  saving: boolean;
}

function RecordModal({ table, record, onSave, onClose, saving }: RecordModalProps) {
  const isEdit = record !== null;

  // Inizializza form data dai campi della tabella
  const [formData, setFormData] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    table.fields.forEach((field) => {
      const key = field.name || field.id || '';
      if (isEdit && record?.data?.[key] !== undefined) {
        initial[key] = record.data[key];
      } else if (field.type === 'checkbox' || field.type === 'boolean') {
        initial[key] = false;
      } else {
        initial[key] = '';
      }
    });
    return initial;
  });

  const handleChange = (key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave(formData);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg max-h-[85vh] overflow-auto rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">
            {isEdit ? `Modifica ${table.label}` : `Nuovo ${table.label}`}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {table.fields.map((field) => {
            const key = field.name || field.id || '';
            const value = formData[key];

            const baseInputClass =
              'w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20';

            return (
              <div key={key}>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {field.label}
                  {field.required && <span className="ml-1 text-red-400">*</span>}
                </label>

                {/* Select/Dropdown */}
                {field.type === 'select' || field.type === 'dropdown' ? (
                  <div className="relative">
                    <select
                      value={String(value ?? '')}
                      onChange={(e) => handleChange(key, e.target.value)}
                      className={`${baseInputClass} appearance-none pr-10`}
                    >
                      <option value="">Seleziona...</option>
                      {(field.options || []).map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                    <ChevronDown
                      size={16}
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                    />
                  </div>
                ) : field.type === 'textarea' ? (
                  <textarea
                    value={String(value ?? '')}
                    onChange={(e) => handleChange(key, e.target.value)}
                    rows={3}
                    className={`${baseInputClass} resize-y`}
                  />
                ) : field.type === 'checkbox' || field.type === 'boolean' ? (
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(value)}
                      onChange={(e) => handleChange(key, e.target.checked)}
                      className="h-5 w-5 rounded border-slate-600 bg-slate-700 accent-indigo-500"
                    />
                    <span className="text-sm text-slate-300">{value ? 'Attivo' : 'Non attivo'}</span>
                  </label>
                ) : field.type === 'number' || field.type === 'currency' ? (
                  <input
                    type="number"
                    step={field.type === 'currency' ? '0.01' : '1'}
                    value={String(value ?? '')}
                    onChange={(e) => handleChange(key, e.target.value)}
                    className={baseInputClass}
                  />
                ) : field.type === 'date' ? (
                  <input
                    type="date"
                    value={String(value ?? '')}
                    onChange={(e) => handleChange(key, e.target.value)}
                    className={baseInputClass}
                  />
                ) : field.type === 'datetime' ? (
                  <input
                    type="datetime-local"
                    value={String(value ?? '')}
                    onChange={(e) => handleChange(key, e.target.value)}
                    className={baseInputClass}
                  />
                ) : field.type === 'email' ? (
                  <input
                    type="email"
                    value={String(value ?? '')}
                    onChange={(e) => handleChange(key, e.target.value)}
                    className={baseInputClass}
                  />
                ) : field.type === 'phone' || field.type === 'tel' ? (
                  <input
                    type="tel"
                    value={String(value ?? '')}
                    onChange={(e) => handleChange(key, e.target.value)}
                    className={baseInputClass}
                  />
                ) : (
                  <input
                    type="text"
                    value={String(value ?? '')}
                    onChange={(e) => handleChange(key, e.target.value)}
                    placeholder={field.placeholder || ''}
                    className={baseInputClass}
                  />
                )}
              </div>
            );
          })}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-semibold text-slate-300 transition-colors hover:bg-slate-800"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving && <Loader2 size={16} className="animate-spin" />}
              {saving ? 'Salvataggio...' : 'Salva'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Format Helpers
// ═══════════════════════════════════════════════════════════════════════════

function fieldKey(f: FieldDef): string {
  return f.name || f.id || '';
}

function formatCellValue(value: unknown, field: FieldDef): string {
  if (value === null || value === undefined) return '—';

  switch (field.type) {
    case 'checkbox':
    case 'boolean':
      return value ? '✓ Sì' : '✗ No';
    case 'currency': {
      const num = Number(value);
      if (isNaN(num)) return String(value);
      return `€ ${num.toLocaleString('it-IT', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
    case 'date':
    case 'datetime': {
      if (typeof value === 'string') {
        try {
          return new Date(value).toLocaleDateString('it-IT', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          });
        } catch {
          return String(value);
        }
      }
      return String(value);
    }
    default:
      return String(value);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Main DynamicTable Component
// ═══════════════════════════════════════════════════════════════════════════

export default function DynamicTable({
  table,
  appId,
  supabaseUrl: configUrl,
  supabaseAnonKey: configKey,
  onRecordsChanged,
  pageSize = 15,
  records: externalRecords,
  loading: externalLoading,
  error: externalError,
  className = '',
}: DynamicTableProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Supabase Client (memoized) ──────────────────────────────────────────
  const supabaseAdmin = useMemo(() => {
    const url = configUrl || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const key = configKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    return createClient<Database>(url, key);
  }, [configUrl, configKey]);

  // ─── State ───────────────────────────────────────────────────────────────
  const [internalRecords, setInternalRecords] = useState<AppRecord[]>([]);
  const [internalLoading, setInternalLoading] = useState(true);
  const [internalError, setInternalError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingRecord, setEditingRecord] = useState<AppRecord | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [exporting, setExporting] = useState(false);

  // ─── Derived: use external or internal data ──────────────────────────────
  const records = externalRecords ?? internalRecords;
  const loading = externalLoading ?? internalLoading;
  const error = externalError ?? internalError;
  const hasExternalRecords = externalRecords !== undefined;

  // ─── Debounce search ────────────────────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setCurrentPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // ─── Fetch Records ──────────────────────────────────────────────────────
  const loadRecords = useCallback(async () => {
    if (hasExternalRecords || !appId || !table.name) return;

    setInternalLoading(true);
    setInternalError(null);

    try {
      // Build query: filtra per app_id e table_name
      let query = supabaseAdmin
        .from('app_records')
        .select('*', { count: 'exact' })
        .eq('app_id', appId)
        .eq('table_name', table.name)
        .order('created_at', { ascending: false });

      // Applica filtro ricerca sui dati JSONB
      if (debouncedSearch.trim()) {
        const searchTerm = debouncedSearch.trim().toLowerCase();
        // Cerca in tutti i campi definiti dalla tabella
        const orFilters = table.fields
          .map((f) => `data->>'${fieldKey(f)}'.ilike.%${searchTerm}%`)
          .join(',');
        if (orFilters) {
          query = query.or(orFilters);
        }
      }

      // Paginazione
      const from = (currentPage - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, count, error: queryError } = await query;

      if (queryError) {
        console.error('[DynamicTable] Query error:', queryError);
        setInternalError(queryError.message);
        setInternalRecords([]);
        setTotalCount(0);
      } else {
        // `data` (colonna jsonb) arriva tipizzato Json; AppRecord.data è
        // Record<string, unknown> per come lo usa il resto del componente.
        setInternalRecords((data || []) as unknown as AppRecord[]);
        setTotalCount(count || 0);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Errore nel caricamento dei dati';
      console.error('[DynamicTable] Load error:', msg);
      setInternalError(msg);
      setInternalRecords([]);
      setTotalCount(0);
    } finally {
      setInternalLoading(false);
    }
  }, [supabaseAdmin, appId, table.name, debouncedSearch, currentPage, pageSize, hasExternalRecords, table.fields]);

  // Fetch quando cambiano i parametri
  useEffect(() => {
    if (!hasExternalRecords) {
      loadRecords();
    }
  }, [loadRecords, hasExternalRecords]);

  // ─── CRUD Handlers ──────────────────────────────────────────────────────
  const handleCreate = useCallback(async (formData: Record<string, unknown>) => {
    if (!appId) return;
    setSaving(true);

    try {
      // Recupera il tenant_id dalla tabella apps
      const { data: appData } = await supabaseAdmin
        .from('apps')
        .select('tenant_id')
        .eq('id', appId)
        .single();

      const tenantId = appData?.tenant_id;
      if (!tenantId) throw new Error('Tenant non trovato');

      const { error: insertError } = await supabaseAdmin.from('app_records').insert({
        app_id: appId,
        tenant_id: tenantId,
        table_name: table.name,
        data: formData as any, // colonna jsonb, formData è già JSON-serializzabile
      });

      if (insertError) throw new Error(insertError.message);

      setModalMode(null);
      setEditingRecord(null);
      await loadRecords();
      onRecordsChanged?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Errore nella creazione');
    } finally {
      setSaving(false);
    }
  }, [supabaseAdmin, appId, table.name, loadRecords, onRecordsChanged]);

  const handleUpdate = useCallback(async (formData: Record<string, unknown>) => {
    if (!editingRecord) return;
    setSaving(true);

    try {
      const { error: updateError } = await supabaseAdmin
        .from('app_records')
        .update({ data: formData as any, updated_at: new Date().toISOString() })
        .eq('id', editingRecord.id)
        .eq('app_id', appId);

      if (updateError) throw new Error(updateError.message);

      setModalMode(null);
      setEditingRecord(null);
      await loadRecords();
      onRecordsChanged?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Errore nella modifica');
    } finally {
      setSaving(false);
    }
  }, [supabaseAdmin, editingRecord, appId, loadRecords, onRecordsChanged]);

  const handleDelete = useCallback(async (recordId: string) => {
    if (!confirm('Sei sicuro di voler eliminare questo record? Questa azione è irreversibile.')) return;

    try {
      const { error: deleteError } = await supabaseAdmin
        .from('app_records')
        .delete()
        .eq('id', recordId)
        .eq('app_id', appId);

      if (deleteError) throw new Error(deleteError.message);

      await loadRecords();
      onRecordsChanged?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Errore nell\'eliminazione');
    }
  }, [supabaseAdmin, appId, loadRecords, onRecordsChanged]);

  // Dispatcher per il salvataggio modale
  const handleModalSave = useCallback(async (data: Record<string, unknown>) => {
    if (modalMode === 'create') {
      await handleCreate(data);
    } else if (modalMode === 'edit') {
      await handleUpdate(data);
    }
  }, [modalMode, handleCreate, handleUpdate]);

  // ─── Export CSV ─────────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (!appId) return;
    setExporting(true);

    try {
      // Fetch all records (no pagination) for export
      const { data, error: exportError } = await supabaseAdmin
        .from('app_records')
        .select('data')
        .eq('app_id', appId)
        .eq('table_name', table.name)
        .order('created_at', { ascending: true });

      if (exportError) throw new Error(exportError.message);
      if (!data || data.length === 0) {
        alert('Nessun record da esportare');
        return;
      }

      // Convert to CSV
      const headers = table.fields.map((f) => fieldKey(f));
      const csvRows = [headers.join(',')];
      for (const row of data) {
        const values = headers.map((h) => {
          const val = (row.data as Record<string, unknown> | null)?.[h];
          if (val === null || val === undefined) return '';
          const str = String(val);
          // Escape quotes and wrap in quotes if contains comma or quote
          return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
        });
        csvRows.push(values.join(','));
      }

      const csvContent = csvRows.join('\n');
      const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${table.name}-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Errore esportazione');
    } finally {
      setExporting(false);
    }
  }, [supabaseAdmin, appId, table, table.fields]);

  // ─── Import CSV ─────────────────────────────────────────────────────────
  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !appId) return;

    setImporting(true);
    setImportMsg('');

    try {
      const text = await file.text();
      const lines = text.split('\n').filter((l) => l.trim());
      if (lines.length < 2) {
        setImportMsg('Il file CSV è vuoto o contiene solo l\'intestazione');
        return;
      }

      const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
      const records = [];

      for (let i = 1; i < lines.length; i++) {
        // Simple CSV parser (gestisce virgole tra virgolette)
        const values: string[] = [];
        let current = '';
        let inQuotes = false;
        for (const char of lines[i]) {
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        values.push(current.trim());

        const rowData: Record<string, unknown> = {};
        headers.forEach((h, idx) => {
          let val: string = values[idx] || '';
          val = val.replace(/^"|"$/g, '');
          rowData[h] = val;
        });
        records.push(rowData);
      }

      // Recupera tenant_id
      const { data: appData } = await supabaseAdmin
        .from('apps')
        .select('tenant_id')
        .eq('id', appId)
        .single();

      const tenantId = appData?.tenant_id;
      if (!tenantId) throw new Error('Tenant non trovato');

      const insertData = records.map((data) => ({
        app_id: appId,
        tenant_id: tenantId,
        table_name: table.name,
        data,
      }));

      const { error: insertError } = await supabaseAdmin.from('app_records').insert(insertData as any);
      if (insertError) throw new Error(insertError.message);

      setImportMsg(`${records.length} record importati con successo`);
      await loadRecords();
      onRecordsChanged?.();
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : 'Errore durante l\'importazione');
    } finally {
      setImporting(false);
      if (e.target) e.target.value = '';
    }
  }, [supabaseAdmin, appId, table.name, loadRecords, onRecordsChanged]);

  // ─── Pagination ─────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header: Titolo + Azioni */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-white">
          {table.icon && <span className="mr-2">{table.icon}</span>}
          {table.labelPlural}
        </h2>

        <div className="flex flex-wrap items-center gap-2">
          {/* Import */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleImport}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {importing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            {importing ? 'Import...' : 'Importa'}
          </button>

          {/* Export */}
          <button
            onClick={handleExport}
            disabled={exporting || records.length === 0}
            className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download size={15} />
            {exporting ? 'Export...' : 'Esporta'}
          </button>

          {/* Nuovo Record */}
          <button
            onClick={() => {
              setEditingRecord(null);
              setModalMode('create');
            }}
            className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500"
          >
            <Plus size={16} />
            Nuovo
          </button>
        </div>
      </div>

      {/* Import Message */}
      {importMsg && (
        <div className={`flex items-center gap-2 rounded-xl p-3 text-sm ${
          importMsg.includes('successo')
            ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
            : 'border border-red-500/30 bg-red-500/10 text-red-400'
        }`}>
          <AlertTriangle size={15} />
          {importMsg}
          <button
            onClick={() => setImportMsg('')}
            className="ml-auto rounded-lg p-0.5 transition-colors hover:bg-white/10"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          <AlertTriangle size={15} />
          {error}
          <button
            onClick={() => setInternalError(null)}
            className="ml-auto rounded-lg p-0.5 transition-colors hover:bg-white/10"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Search Bar */}
      <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3">
        <Search size={18} className="text-slate-400" />
        <input
          type="text"
          placeholder={`Cerca in ${table.labelPlural}...`}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 border-none bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <X size={16} />
          </button>
        )}
        {debouncedSearch && loading && (
          <Loader2 size={16} className="animate-spin text-slate-500" />
        )}
      </div>

      {/* Tabella */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        <div className="max-h-[600px] overflow-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-800/80 backdrop-blur">
                {table.fields.map((field) => (
                  <th
                    key={fieldKey(field)}
                    className="whitespace-nowrap border-b-2 border-slate-700 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400"
                  >
                    {field.label}
                  </th>
                ))}
                <th className="whitespace-nowrap border-b-2 border-slate-700 px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Azioni
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {loading ? (
                <tr>
                  <td colSpan={table.fields.length + 1} className="px-4 py-16 text-center">
                    <div className="flex items-center justify-center gap-2 text-slate-400">
                      <Loader2 size={20} className="animate-spin" />
                      <span className="text-sm">Caricamento record...</span>
                    </div>
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={table.fields.length + 1} className="px-4 py-12 text-center">
                    <div className="text-slate-500">
                      <p className="text-lg">📋</p>
                      <p className="mt-2 text-sm">
                        {debouncedSearch
                          ? 'Nessun risultato per la ricerca'
                          : 'Nessun record presente. Clicca "Nuovo" per aggiungere il primo.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                records.map((record) => (
                  <tr
                    key={record.id}
                    className="transition-colors hover:bg-slate-800/30"
                  >
                    {table.fields.map((field) => (
                      <td
                        key={fieldKey(field)}
                        className="max-w-[250px] truncate whitespace-nowrap px-4 py-3 text-sm text-slate-300"
                        title={String(record.data?.[fieldKey(field)] ?? '')}
                      >
                        {formatCellValue(record.data?.[fieldKey(field)], field)}
                      </td>
                    ))}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => {
                            setEditingRecord(record);
                            setModalMode('edit');
                          }}
                          title="Modifica"
                          className="rounded-lg p-2 text-indigo-400 transition-colors hover:bg-indigo-500/20 hover:text-indigo-300"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => handleDelete(record.id)}
                          title="Elimina"
                          className="rounded-lg p-2 text-red-400 transition-colors hover:bg-red-500/20 hover:text-red-300"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer: Record count + Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-800 px-4 py-3">
          <span className="text-xs text-slate-500">
            {totalCount} record{totalCount !== 1 ? 'i' : 'o'} totali
            {debouncedSearch && ` · ricerca: "${debouncedSearch}"`}
          </span>

          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronLeft size={16} />
              </button>

              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                // Show pages around current page
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }

                return (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={`min-w-[36px] rounded-lg px-2 py-1.5 text-sm font-medium transition-colors ${
                      pageNum === currentPage
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}

              {totalPages > 5 && currentPage < totalPages - 2 && (
                <span className="px-1 text-slate-500">...</span>
              )}

              {totalPages > 5 && currentPage < totalPages - 2 && (
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  className="min-w-[36px] rounded-lg px-2 py-1.5 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
                >
                  {totalPages}
                </button>
              )}

              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Modal Form */}
      {modalMode && (
        <RecordModal
          table={table}
          record={modalMode === 'edit' ? editingRecord : null}
          onSave={handleModalSave}
          onClose={() => {
            setModalMode(null);
            setEditingRecord(null);
          }}
          saving={saving}
        />
      )}
    </div>
  );
}