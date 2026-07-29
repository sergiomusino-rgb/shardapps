import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

// ─── GET /api/apps/[id]/records ────────────────────────────────────────────
// Lettura owner-side (dashboard/reseller) dei dati raccolti da un'app
// generata, per la scheda "Dati Raccolti" (/a/[slug]/settings). Autentica il
// proprietario della piattaforma (Bearer del suo access token, stesso schema
// delle altre route sotto /api/apps/[id]) invece del client_password/JWT
// cliente: a differenza di DynamicTable (frontend/components/DynamicTable.tsx,
// usato DENTRO l'app dal cliente) qui non serve replicare l'auth_mode
// dell'app (legacy password vs Supabase Auth), che il proprietario non
// possiede comunque per le app auth_mode='supabase'.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 });
    }

    const authClient = createClient<Database>(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 });
    }

    const { id } = await params;
    const tableName = req.nextUrl.searchParams.get('table');

    const adminClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: app, error: appError } = await adminClient
      .from('apps')
      .select('id, tenant_id')
      .eq('id', id)
      .single();

    if (appError || !app) {
      return NextResponse.json({ error: 'App non trovata' }, { status: 404 });
    }

    const { data: membership } = await adminClient
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', user.id)
      .eq('tenant_id', app.tenant_id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 });
    }

    let query = adminClient
      .from('app_records')
      .select('id, table_name, data, created_at, updated_at')
      .eq('app_id', id)
      .order('created_at', { ascending: false });

    if (tableName) {
      query = query.eq('table_name', tableName);
    }

    const { data: records, error: recordsError } = await query;

    if (recordsError) {
      console.error('[GET /api/apps/:id/records] error:', recordsError);
      return NextResponse.json({ error: 'Errore lettura record' }, { status: 500 });
    }

    return NextResponse.json({ records: records || [] });
  } catch (error) {
    console.error('[GET /api/apps/:id/records] error:', error);
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }
}
