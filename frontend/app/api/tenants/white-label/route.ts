// ─── Tenant White Label API ─────────────────────────────────────────────────
// GET/PATCH del logo reseller ("Brandizza la tua app", piano Business),
// letto da qui in dashboard/creator/page.tsx (CreatorBrandingPanel) e
// applicato automaticamente a ogni pubblicazione da getTenantWhiteLabel
// (src/lib/creator-server.ts, usato in api/creator/publish e api/creator/create).
// L'upload del file avviene lato client direttamente su Supabase Storage
// (bucket vision-uploads, stesso pattern di ComandiInstanceDashboard.tsx
// CompanyTab): questa route salva solo l'URL pubblico risultante + il testo.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function resolveTenant(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { error: NextResponse.json({ error: 'Non autorizzato' }, { status: 401 }) };

  const authClient = createClient<Database>(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) return { error: NextResponse.json({ error: 'Utente non autenticato' }, { status: 401 }) };

  const adminClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: memberships } = await adminClient
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', user.id)
    .limit(1);

  const tenantId = memberships?.[0]?.tenant_id;
  if (!tenantId) return { error: NextResponse.json({ error: 'Tenant non trovato' }, { status: 404 }) };

  return { adminClient, tenantId };
}

export async function GET(req: NextRequest) {
  try {
    const resolved = await resolveTenant(req);
    if (resolved.error) return resolved.error;
    const { adminClient, tenantId } = resolved;

    const { data: tenant, error } = await adminClient
      .from('tenants')
      .select('plan, white_label_logo_url, white_label_label')
      .eq('id', tenantId)
      .single();

    if (error || !tenant) {
      return NextResponse.json({ error: 'Tenant non trovato' }, { status: 404 });
    }

    return NextResponse.json({ tenant });
  } catch (error) {
    console.error('[GET /api/tenants/white-label] error:', error);
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }
}

const MAX_URL_LENGTH = 2000;
const MAX_LABEL_LENGTH = 40;

export async function PATCH(req: NextRequest) {
  try {
    const resolved = await resolveTenant(req);
    if (resolved.error) return resolved.error;
    const { adminClient, tenantId } = resolved;

    const { data: tenant } = await adminClient
      .from('tenants')
      .select('plan')
      .eq('id', tenantId)
      .single();

    if ((tenant as { plan?: string } | null)?.plan !== 'business') {
      return NextResponse.json(
        { error: 'Il white label è disponibile solo con il piano Business', code: 'PLAN_REQUIRED' },
        { status: 403 }
      );
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Body della richiesta non è JSON valido' }, { status: 400 });
    }
    const updates: Record<string, string | null> = {};

    if ('white_label_logo_url' in body) {
      const val = body.white_label_logo_url;
      if (typeof val === 'string' && val.length > MAX_URL_LENGTH) {
        return NextResponse.json({ error: 'URL logo troppo lungo' }, { status: 400 });
      }
      updates.white_label_logo_url = typeof val === 'string' && val ? val : null;
    }
    if ('white_label_label' in body) {
      const val = body.white_label_label;
      if (typeof val === 'string' && val.length > MAX_LABEL_LENGTH) {
        return NextResponse.json({ error: 'Testo troppo lungo' }, { status: 400 });
      }
      updates.white_label_label = typeof val === 'string' && val ? val : null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nessun campo da aggiornare' }, { status: 400 });
    }

    const { data: tenantUpdated, error: updateError } = await adminClient
      .from('tenants')
      // updates è whitelisted sopra: il cast bypassa la corrispondenza esatta col tipo Update generato.
      .update(updates as any)
      .eq('id', tenantId)
      .select('plan, white_label_logo_url, white_label_label')
      .single();

    if (updateError || !tenantUpdated) {
      console.error('[PATCH /api/tenants/white-label] update error:', updateError);
      return NextResponse.json({ error: 'Errore salvataggio' }, { status: 500 });
    }

    return NextResponse.json({ success: true, tenant: tenantUpdated });
  } catch (error) {
    console.error('[PATCH /api/tenants/white-label] error:', error);
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }
}
