// ─── Comandi: download export tabella "Ordini" (CSV/Excel) ────────────────
// GET /api/comandi/orders-export?format=csv|xlsx
// Stesso principio di sicurezza delle altre route Comandi (catalog/import,
// agent-voice-order): tenant_id derivato ESCLUSIVAMENTE dall'utente risolto
// dal token Bearer via tenant_members, mai da un valore fornito dal client.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { buildOrdersExportRows, rowsToCsv, rowsToXlsxBuffer } from '@/src/lib/comandi-orders-export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function getUserIdFromBearerToken(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  const supabaseAuth = createClient<Database>(supabaseUrl, supabaseAnonKey);
  try {
    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
  } catch (err) {
    console.error('[orders-export] Auth error:', err);
    return null;
  }
}

export async function GET(request: NextRequest) {
  if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
    return NextResponse.json({ error: 'Servizio non configurato correttamente.' }, { status: 500 });
  }

  const userId = await getUserIdFromBearerToken(request);
  if (!userId) {
    return NextResponse.json({ error: 'Autenticazione richiesta.' }, { status: 401 });
  }

  const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: membership } = await supabaseAdmin
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', userId)
    .limit(1)
    .single();

  const tenantId = (membership as { tenant_id?: string } | null)?.tenant_id;
  if (!tenantId) {
    return NextResponse.json({ error: 'Nessun tenant associato all\'utente.' }, { status: 403 });
  }

  const format = request.nextUrl.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv';
  const rows = await buildOrdersExportRows(supabaseAdmin, tenantId);

  if (format === 'xlsx') {
    const buffer = rowsToXlsxBuffer(rows);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="ordini.xlsx"',
      },
    });
  }

  const csv = rowsToCsv(rows);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="ordini.csv"',
    },
  });
}
