'use client';

// Risolve il ruolo (tenant_members.role) dell'utente autenticato corrente per
// un dato tenant. Usato per adattare la UI lato client (nascondere sezioni
// non autorizzate per il ruolo 'agent': dati aziendali, incassi, gestione
// catalogo) — la sicurezza reale resta lato server (RLS su tenant_members/
// orders + i controlli espliciti in app/api/agent-voice-order/route.ts e
// nelle Server Action Comandi), questo hook serve solo a dare un'interfaccia
// coerente col ruolo, non a fare enforcement.

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/src/lib/supabase-browser';
import type { TenantMemberRole } from '@/types/comandi';

export interface UseComandiRoleResult {
  role: TenantMemberRole | null;
  loading: boolean;
}

export function useComandiRole(tenantId: string | undefined | null): UseComandiRoleResult {
  const [role, setRole] = useState<TenantMemberRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (!tenantId) {
      setRole(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    (async () => {
      const {
        data: { user },
      } = await supabaseBrowser.auth.getUser();
      if (cancelled) return;

      if (!user) {
        setRole(null);
        setLoading(false);
        return;
      }

      const { data } = await supabaseBrowser
        .from('tenant_members' as any)
        .select('role')
        .eq('user_id', user.id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (!cancelled) {
        setRole((data as { role: TenantMemberRole } | null)?.role ?? null);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return { role, loading };
}
