import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import type { Database } from '@/types/database';

// ─── POST /api/apps/decrement-fee ───────────────────────────────────────────
// Security audit fix: dashboard/projects/[id]/page.tsx ('use client')
// chiamava direttamente il backend leggendo process.env.BACKEND_SERVICE_TOKEN
// — una variabile senza prefisso NEXT_PUBLIC_, quindi sempre `undefined` nel
// bundle browser (Next.js non la inietta lato client). La chiamata era di
// fatto sempre "Bearer undefined": innocua oggi (il token reale non è mai
// arrivato al client), ma un pattern pericoloso da correggere prima che
// qualcuno "risolva" il bug rinominando la env in NEXT_PUBLIC_*, esponendo
// il segreto condiviso a chiunque. Questa route sposta la chiamata
// server-to-server lato server, mai raggiungibile dal browser — stesso
// pattern già usato da POST /api/apps (route.ts, azione "increment") per la
// creazione app, qui il simmetrico "decrement" per l'eliminazione.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://shardapps-backend.onrender.com';

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 });
    }

    const authClient = createClient<Database>(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Utente non autenticato' }, { status: 401 });
    }

    // Il tenant si deriva SEMPRE dalla sessione autenticata, mai da un id
    // fornito dal client: un utente può far decrementare solo il fee del
    // proprio tenant. Service role perché tenant_members è protetta da RLS
    // e qui non serve/non conviene ri-autenticare come l'utente per una
    // singola SELECT.
    const adminClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: memberships } = await adminClient
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', user.id)
      .limit(1);

    const tenantId = memberships?.[0]?.tenant_id;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant non trovato' }, { status: 404 });
    }

    const backendRes = await fetch(`${backendUrl}/api/update-app-fee`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.BACKEND_SERVICE_TOKEN}`,
        'Content-Type': 'application/json',
        'X-User-ID': user.id,
        'X-User-Email': user.email || '',
      },
      body: JSON.stringify({ tenantId, action: 'decrement' }),
    });

    if (!backendRes.ok) {
      console.error('[POST /api/apps/decrement-fee] backend error:', backendRes.status);
      return NextResponse.json({ error: 'Errore aggiornamento fee sul backend' }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/apps/decrement-fee] error:', error);
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }
}
