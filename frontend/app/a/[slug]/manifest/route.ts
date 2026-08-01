import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { NextRequest, NextResponse } from 'next/server';
import { getDesignTokens } from '@/lib/designTokens';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

// Manifest PWA dinamico per app generata: nome, logo e palette (theme/background
// color) presi dai dati reali dell'app invece del placeholder generico ZeusX,
// cosi' l'icona/splash installata sulla Home corrisponde al brand del cliente.
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const { data: app } = await supabase
    .from('apps')
    .select('id, name, config, app_type, tenant_id')
    .eq('slug', slug)
    .single();

  // Comandi ha uno schema/dashboard fisso (niente app_records/config.branding,
  // quelli sono del motore a schema generato da AI): il nome reale è quello
  // compilato dal titolare in tenants.name (tab Azienda), palette e icona sono
  // fisse sul brand ambra di Comandi invece di passare per getDesignTokens
  // (pensato per i settori oculista/officina/ristorante del motore generico).
  if ((app as { app_type?: string } | null)?.app_type === 'comandi_ai') {
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
    const appName = tenantName || app?.name || 'Comand AI';

    // Il logo caricato dal titolare in Azienda ha priorità sull'icona fissa
    // Comand AI: è così che ogni tenant installa l'app con la propria
    // identità (icona + nome) invece del brand del reseller.
    const icons = [
      // Niente 'type' fisso: il file caricato può essere jpg/png/webp — il
      // browser lo determina dal Content-Type servito da Supabase Storage,
      // dichiarare qui 'image/png' su un jpg reale farebbe scartare l'icona.
      ...(tenantLogo ? [{ src: tenantLogo, sizes: 'any', purpose: 'any' as const }] : []),
      { src: '/icons/comandi-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/comandi-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/comandi-icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ];

    const manifest = {
      name: appName,
      short_name: appName.length > 14 ? `${appName.slice(0, 13)}…` : appName,
      description: `Gestionale ordini di ${appName}, powered by Comand AI`,
      start_url: `/a/${slug}/dashboard`,
      scope: `/a/${slug}`,
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#030712',
      theme_color: '#d97706',
      icons,
      screenshots: [],
      prefer_related_applications: false,
      categories: ['business', 'productivity'],
    };

    return NextResponse.json(manifest, {
      headers: {
        'Content-Type': 'application/manifest+json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300, must-revalidate',
      },
    });
  }

  const config = (app?.config || {}) as Record<string, unknown>;
  const branding = (config.branding || {}) as Record<string, unknown>;
  const sector = (config.sector as string) || (config.blueprint as any)?.sector || '';

  // Dati aziendali reali (compilati dal titolare dopo la generazione): quando
  // presenti hanno priorità sul nome/logo generico salvato in config alla
  // generazione AI, stessa fonte usata dalla landing page pubblica.
  let realName: string | null = null;
  let realLogo: string | null = null;
  if (app?.id) {
    const { data: record } = await supabase
      .from('app_records')
      .select('data')
      .eq('app_id', app.id)
      .eq('table_name', 'dati_aziendali')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const raw = (record?.data || {}) as Record<string, unknown>;
    realName = typeof raw.ragione_sociale === 'string' ? raw.ragione_sociale : null;
    realLogo = typeof raw.logo === 'string' ? raw.logo : null;
  }

  const appName = realName || (branding.company_name as string) || (config.appName as string) || app?.name || 'ZeusX App';
  const description = (config.description as string) || `Gestionale ${appName}`;
  const logo = realLogo || (branding.logo_url as string) || (config.logo as string) || '';

  const designTokens = getDesignTokens(sector, `${appName} ${description}`);
  const themeColor = (branding.primary_color as string) || designTokens.colors.primary;
  const backgroundColor = designTokens.colors.bg;

  const icons = [
    ...(logo
      ? [{ src: logo, sizes: 'any', purpose: 'any' }]
      : []),
    { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  ];

  const manifest = {
    name: appName,
    short_name: appName.length > 14 ? `${appName.slice(0, 13)}…` : appName,
    description,
    start_url: `/a/${slug}`,
    scope: `/a/${slug}`,
    display: 'standalone',
    orientation: 'portrait',
    background_color: backgroundColor,
    theme_color: themeColor,
    icons,
    screenshots: [],
    prefer_related_applications: false,
    categories: ['business', 'productivity'],
  };

  return NextResponse.json(manifest, {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300, must-revalidate',
    },
  });
}
