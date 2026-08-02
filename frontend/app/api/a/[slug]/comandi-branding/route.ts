import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

// GET /api/a/[slug]/comandi-branding — nome e logo del tenant per un'istanza
// Comandi, letti da tenants.name/logo_url (stessa fonte del manifest
// dinamico, vedi app/a/[slug]/manifest/route.ts). Nessuna autenticazione
// richiesta: la landing pubblica di un'istanza Comandi (ComandiInstanceLanding,
// prima del login) deve poter impostare l'icona/nome corretti per
// l'installazione PWA su iOS — che si basa sui meta tag apple-touch-icon/
// apple-mobile-web-app-title impostati lato client, non sul manifest, quindi
// serve un fetch pubblico separato invece della sola tabella tenants (le cui
// RLS restringono la lettura ai soli membri del tenant). Solo nome e logo,
// nessun dato sensibile.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const { data: app } = await supabase
      .from('apps')
      .select('id, name, app_type, tenant_id')
      .eq('slug', slug)
      .eq('app_type', 'comandi_ai')
      .single();

    if (!app) {
      return NextResponse.json({ error: 'App non trovata' }, { status: 404 });
    }

    const tenantId = (app as { tenant_id?: string }).tenant_id;
    let tenantName: string | null = null;
    let tenantLogo: string | null = null;
    if (tenantId) {
      // Cast necessario: 'logo_url' (migrazione 20260808000010) non è ancora
      // presente nel tipo Database generato.
      const { data: tenant } = await (supabase as any)
        .from('tenants')
        .select('name, logo_url')
        .eq('id', tenantId)
        .single();
      const t = tenant as { name?: string; logo_url?: string } | null;
      tenantName = t?.name || null;
      tenantLogo = t?.logo_url || null;
    }

    return NextResponse.json({
      name: tenantName || (app as { name?: string }).name || null,
      logoUrl: tenantLogo,
    });
  } catch (error) {
    console.error('[comandi-branding] error:', error);
    return NextResponse.json(
      { error: 'Errore di connessione al server' },
      { status: 500 }
    );
  }
}
