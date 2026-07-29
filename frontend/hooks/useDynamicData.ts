'use client';

import { useState, useEffect, useCallback } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseBrowser } from '@/src/lib/supabase-browser';

// tableName è dinamico a runtime (tabelle custom per-tenant, non fanno parte
// dello schema statico generato): il client tipizzato <Database> non può
// inferire relazioni/colonne per un nome tabella arbitrario, quindi qui si
// usa deliberatamente la vista non tipizzata dello stesso client.
const untypedSupabase = supabaseBrowser as unknown as SupabaseClient;

export interface DynamicRecord {
  id: string;
  tenant_id?: string;
  [key: string]: unknown;
}

export interface UseDynamicDataResult {
  records: DynamicRecord[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook per recuperare i dati da una tabella specificata nello schema,
 * applicando il filtro tenant_id per la sicurezza multi-tenant.
 *
 * @param tableName - Nome della tabella da interrogare
 * @param tenantId - ID del tenant per filtrare i record (RLS + filtro esplicito)
 * @param enabled - Se false, non esegue la query (default: true)
 */
export function useDynamicData(
  tableName: string | undefined,
  tenantId: string | undefined,
  enabled: boolean = true
): UseDynamicDataResult {
  const [records, setRecords] = useState<DynamicRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRecords = useCallback(async () => {
    if (!tableName || !tenantId || !enabled) {
      setRecords([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: queryError } = await untypedSupabase
        .from(tableName)
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

      if (queryError) {
        console.error(`[useDynamicData] Error fetching ${tableName}:`, queryError);
        setError(queryError.message || `Errore nel caricamento dei dati da ${tableName}`);
        setRecords([]);
        return;
      }

      setRecords(data || []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Errore sconosciuto';
      console.error(`[useDynamicData] Unexpected error for ${tableName}:`, err);
      setError(msg);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [tableName, tenantId, enabled]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  return {
    records,
    loading,
    error,
    refetch: fetchRecords,
  };
}