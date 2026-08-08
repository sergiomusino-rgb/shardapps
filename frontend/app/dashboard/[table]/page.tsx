'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { getTableConfig, UITable, SECTOR_LABELS, TABLE_CATALOG } from '@/lib/table-config';
import DynamicTable from '@/components/DynamicTablev2';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

/**
 * Pagina dinamica dashboard/[table]
 *
 * Esempi di URL validi:
 * - /dashboard/patients    (Pazienti - Studio Oculistico)
 * - /dashboard/appointments (Appuntamenti - Studio Oculistico)
 * - /dashboard/customers    (Clienti - Officina)
 * - /dashboard/vehicles     (Veicoli - Officina)
 * - /dashboard/jobs         (Lavorazioni - Officina)
 * - /dashboard/dishes       (Menu - Ristorante)
 * - /dashboard/reservations (Prenotazioni - Ristorante)
 *
 * Il parametro [table] viene validato contro il catalogo TABLE_CATALOG.
 * Se non trovato, mostra un errore 404 user-friendly.
 */
export default function DynamicTablePage() {
  const params = useParams();
  const rawTable = params.table as string;

  // ─── State ───────────────────────────────────────────────────────────────
  const [tableConfig, setTableConfig] = useState<UITable | null>(null);
  const [appId, setAppId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ─── Validate table name & fetch appId ───────────────────────────────────
  useEffect(() => {
    const config = getTableConfig(rawTable);

    if (!config) {
      setError(
        `Tabella "${rawTable}" non trovata nel catalogo. ` +
        `Tabelle disponibili: ${Object.keys(TABLE_CATALOG).join(', ')}`
      );
      setLoading(false);
      return;
    }

    setTableConfig(config);

    // Recupera l'ID dell'app associata al settore della tabella
    async function fetchAppId() {
      try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
        const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);

        // Ottieni l'utente corrente
        const { data: { user }, error: userError } = await supabase.auth.getUser();

        if (userError || !user) {
          setError('Devi effettuare l\'accesso per visualizzare questa pagina.');
          setLoading(false);
          return;
        }

        // Trova il tenant dell'utente
        const { data: membership, error: memberError } = await supabase
          .from('tenant_members')
          .select('tenant_id')
          .eq('user_id', user.id)
          .limit(1)
          .single();

        if (memberError || !membership) {
          setError('Nessun tenant associato al tuo account. Crea prima un\'app dal Generator AI.');
          setLoading(false);
          return;
        }

        // Trova un'app attiva per il settore della tabella
        const { data: appData, error: appError } = await supabase
          .from('apps')
          .select('id, name')
          .eq('tenant_id', membership.tenant_id)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();

        if (appError) {
          console.error('[TablePage] Error fetching app:', appError);
          setError('Errore nel recupero dell\'app. Riprova più tardi.');
          setLoading(false);
          return;
        }

        if (!appData) {
          setError(
            `Nessuna app attiva trovata per il settore "${SECTOR_LABELS[config!.sector] || config!.sector}". ` +
            'Crea un\'app dal Generator AI prima di visualizzare i dati.'
          );
          setLoading(false);
          return;
        }

        setAppId(appData.id);
        setLoading(false);
      } catch (err) {
        console.error('[TablePage] Unexpected error:', err);
        setError('Errore imprevisto. Riprova più tardi.');
        setLoading(false);
      }
    }

    fetchAppId();
  }, [rawTable]);

  // ─── Records changed callback ────────────────────────────────────────────
  const handleRecordsChanged = useCallback(() => {
    // Il componente DynamicTable gestisce già il refresh interno.
    // Questo callback può essere usato per side effects (es. invalidare cache, analytics)
    console.log(`[TablePage] Records changed for table: ${rawTable}`);
  }, [rawTable]);

  // ─── Loading State ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-slate-600 border-t-indigo-500" />
          <p className="text-sm text-slate-400">Caricamento configurazione tabella...</p>
        </div>
      </div>
    );
  }

  // ─── Error State ─────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
          <div className="mb-4 text-5xl">
            {error.includes('non trovata') ? '🔍' : '⚠️'}
          </div>
          <h2 className="mb-3 text-xl font-bold text-white">
            {error.includes('non trovata') ? 'Tabella non trovata' : 'Attenzione'}
          </h2>
          <p className="mb-6 text-sm leading-relaxed text-slate-400">{error}</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-5 py-2.5 text-sm font-semibold text-slate-300 transition-colors hover:bg-slate-700"
            >
              <ArrowLeft size={16} />
              Torna alla Dashboard
            </Link>
            <Link
              href="/dashboard/generator"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500"
            >
              ✨ Crea Nuova App
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ─── Ready to render ─────────────────────────────────────────────────────
  if (!tableConfig || !appId) {
    return null; // non dovrebbe mai succedere, ma per sicurezza
  }

  return (
    <div className="mx-auto max-w-7xl">
      {/* Breadcrumb / Page Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Link href="/dashboard" className="hover:text-slate-300 transition-colors">
              Dashboard
            </Link>
            <span>/</span>
            <span className="text-slate-400">
              {SECTOR_LABELS[tableConfig.sector] || tableConfig.sector}
            </span>
            <span>/</span>
            <span className="font-medium text-indigo-400">
              {tableConfig.labelPlural}
            </span>
          </div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">
            {tableConfig.icon && <span className="mr-2">{tableConfig.icon}</span>}
            {tableConfig.labelPlural}
          </h1>
          {tableConfig.description && (
            <p className="mt-1 text-sm text-slate-400">{tableConfig.description}</p>
          )}
        </div>
      </div>

      {/* Dynamic Table */}
      <DynamicTable
        table={{
          name: tableConfig.name,
          label: tableConfig.label,
          labelPlural: tableConfig.labelPlural,
          icon: tableConfig.icon,
          fields: tableConfig.fields.map((f) => ({
            name: f.id,
            id: f.id,
            label: f.label,
            type: f.type,
            options: f.options,
            required: f.required,
            placeholder: f.placeholder,
            target: f.target,
            targetLabel: f.targetLabel,
          })),
        }}
        appId={appId}
        onRecordsChanged={handleRecordsChanged}
        pageSize={20}
      />
    </div>
  );
}