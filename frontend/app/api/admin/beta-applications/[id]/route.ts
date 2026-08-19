import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ─── PATCH /api/admin/beta-applications/:id — Pre-Beta Hardening, Blocco 4 ─
// Cambia lo status di UNA candidatura (new/reviewing/approved/rejected/
// contacted, stesso vocabolario del CHECK constraint della migration). Stessa
// auth di GET /api/admin/beta-applications (vedi quel file per il perché
// verifyAdmin è duplicato qui invece che condiviso).

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

// Private Beta (Blocco 2): l'accesso beta di un tenant è normalmente
// impostato una sola volta, al momento della creazione del tenant (vedi
// src/lib/creator-server.ts::getOrCreateTenant, stessa query su
// beta_applications). Ma il gate di signup (trigger enforce_beta_allowlist,
// migration 20260830000000) impedisce di norma che un tenant esista PRIMA
// dell'approvazione — quindi questa sincronizzazione copre solo i casi limite
// (utente pre-esistente da prima di questa migration, o approvato/revocato
// dopo che il tenant è già stato creato): best-effort, non deve mai far
// fallire il cambio di status stesso, che resta l'operazione primaria di
// questa route.
async function syncTenantBetaAccess(status: string, email: string): Promise<void> {
  try {
    const { data: tenantId, error: lookupError } = await supabaseAdmin.rpc('find_owned_tenant_id_by_email', { p_email: email });

    if (lookupError) {
      console.error('[syncTenantBetaAccess] find_owned_tenant_id_by_email fallita:', lookupError);
      return;
    }
    if (!tenantId) return; // nessun tenant ancora creato per questa email: niente da sincronizzare

    const { error: updateError } = await supabaseAdmin
      .from('tenants')
      .update({ beta_access: status === 'approved', updated_at: new Date().toISOString() })
      .eq('id', tenantId);

    if (updateError) {
      console.error('[syncTenantBetaAccess] update tenants.beta_access fallito:', updateError);
    }
  } catch (err) {
    console.error('[syncTenantBetaAccess] errore inatteso:', err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await verifyAdmin(request))) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'id mancante' }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Body JSON non valido' }, { status: 400 });
    }

    const status = (body as { status?: unknown } | null)?.status;
    if (typeof status !== 'string' || !VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: `status non valido. Ammessi: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('beta_applications')
      .update({ status })
      .eq('id', id)
      .select('id, status, email')
      .maybeSingle();

    if (error) {
      console.error('[PATCH /api/admin/beta-applications/:id] errore update:', error);
      return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Candidatura non trovata' }, { status: 404 });
    }

    // Best-effort, mai bloccante: vedi commento su syncTenantBetaAccess.
    await syncTenantBetaAccess(data.status, data.email);

    return NextResponse.json({ application: { id: data.id, status: data.status } });
  } catch (err) {
    console.error('[PATCH /api/admin/beta-applications/:id] errore:', err);
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }
}
