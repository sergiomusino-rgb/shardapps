import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeTotalumGenerationAccess } from '@/src/lib/totalum-generation-authorization';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const TOTALUM_API_URL = process.env.TOTALUM_API_URL || 'https://api-accounts.totalum.app';
const TOTALUM_API_KEY = process.env.TOTALUM_API_KEY;

const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

// Client separato (anon key) solo per verificare il JWT del chiamante — non
// deve mai usare la service role per l'auth.getUser(). Stesso schema di
// generate/status/route.ts.
function getSupabaseAuth() {
  return createClient<Database>(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// GET /api/generate/project?projectId=...
//
// Fase 5B (fix esposizione chiave Totalum, audit Fase 5A): gemella di
// generate/status/route.ts, ma recupera i dati completi del progetto
// (schema/nome generati) invece dello stato di avanzamento — stessa
// verifica Bearer JWT + ownership PRIMA di contattare Totalum, vedi il
// commento lì per il dettaglio completo.
export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get('projectId');
    if (!projectId) {
      return NextResponse.json({ error: 'projectId mancante' }, { status: 400 });
    }

    const authHeader = req.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    let user: { id: string } | null = null;
    if (token) {
      const { data } = await getSupabaseAuth().auth.getUser(token);
      user = data.user;
    }

    let ownershipRow: { user_id: string; tenant_id: string | null } | null = null;
    let callerTenantId: string | null = null;
    if (token && user) {
      const { data } = await supabase
        .from('totalum_generation_requests')
        .select('user_id, tenant_id')
        .eq('project_id', projectId)
        .maybeSingle();
      ownershipRow = data;

      const { data: membership } = await supabase
        .from('tenant_members')
        .select('tenant_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();
      callerTenantId = membership?.tenant_id ?? null;
    }

    const decision = authorizeTotalumGenerationAccess({ token, user, ownershipRow, callerTenantId });
    if (!decision.ok) {
      return NextResponse.json({ error: decision.error }, { status: decision.status });
    }

    if (!TOTALUM_API_KEY) {
      return NextResponse.json({ error: 'Servizio non configurato' }, { status: 503 });
    }

    const totalumRes = await fetch(
      `${TOTALUM_API_URL}/api/v1/vcaas/projects/${encodeURIComponent(projectId)}`,
      { headers: { 'api-key': TOTALUM_API_KEY } }
    );
    const data = await totalumRes.json().catch(() => null);
    return NextResponse.json(data, { status: totalumRes.status });
  } catch (err) {
    console.error('[generate/project] error:', err);
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }
}
