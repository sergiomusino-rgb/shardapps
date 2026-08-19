import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ─── GET /api/admin/beta-applications — Pre-Beta Hardening, Blocco 4 ───────
// Dashboard admin minima per revisionare le candidature Private Beta
// (beta_applications, migration 20260825000000_beta_applications.sql):
// prima di questa route l'unico modo di vederle/approvarle era una query SQL
// manuale su Supabase — la tabella ha RLS deny-all (nessun accesso da anon/
// authenticated tramite la Data API pubblica), quindi questo endpoint con
// service role key è l'UNICO percorso di lettura oltre a Supabase Dashboard.
//
// Auth: stesso identico pattern (Bearer JWT + ADMIN_USER_ID hardcoded +
// fallback profiles.role==='admin') già in uso in ogni altra route
// /api/admin/* esistente (vedi app/api/admin/takeover/route.ts,
// reseller-debts/route.ts, mark-paid/route.ts) — duplicato qui di proposito
// invece di un refactor verso un helper condiviso, per non toccare route
// admin esistenti e funzionanti senza necessità (istruzione esplicita del
// task Pre-Beta Hardening).

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const ADMIN_USER_ID = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';

async function verifyAdmin(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.substring(7);
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);

  if (!user) return false;
  if (user.id === ADMIN_USER_ID) return true;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single();

  return profile?.role === 'admin';
}

const VALID_STATUSES = ['new', 'reviewing', 'approved', 'rejected', 'contacted'];

export async function GET(request: NextRequest) {
  try {
    if (!(await verifyAdmin(request))) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 });
    }

    const statusFilter = request.nextUrl.searchParams.get('status');
    if (statusFilter && !VALID_STATUSES.includes(statusFilter)) {
      return NextResponse.json({ error: `status non valido. Ammessi: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
    }

    let query = supabaseAdmin
      .from('beta_applications')
      .select('id, full_name, company_name, email, website, country, business_type, client_count, app_types, expected_apps, message, status, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (statusFilter) {
      query = query.eq('status', statusFilter);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[GET /api/admin/beta-applications] errore query:', error);
      return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
    }

    return NextResponse.json({ applications: data || [] });
  } catch (err) {
    console.error('[GET /api/admin/beta-applications] errore:', err);
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }
}
