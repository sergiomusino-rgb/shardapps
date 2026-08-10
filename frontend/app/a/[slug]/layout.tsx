import type { Metadata } from 'next';
import type { PropsWithChildren } from 'react';
import { createClient } from '@supabase/supabase-js';
import AppLayoutClient from './AppLayoutClient';

// ─── Metadata dinamici per app pubblicata (Fase 8C, fix P2 smoke test) ─────
// generateMetadata() gira solo in Server Component: la logica esistente
// (auth/gate/paywall/provider) resta invariata, spostata di peso in
// AppLayoutClient.tsx ('use client'), qui invariata al carattere. Questo
// file resta un thin wrapper server-side che aggiunge solo i metadata.
//
// Stesso fallback del layout radice (app/layout.tsx): se lo slug non
// corrisponde a nessuna app, o manca un titolo/descrizione utilizzabile, la
// pagina mostra i metadata generici ShardApps — mai un errore server (nessun
// notFound()/throw qui: il gate "app non trovata" resta comunque gestito,
// invariato, da AppLayoutClient more sotto).
const DEFAULT_TITLE = 'ShardApps - Generazione Gestionali AI';
const DEFAULT_DESCRIPTION = 'Crea gestionali personalizzati con intelligenza artificiale per il tuo business';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(supabaseUrl, serviceRoleKey);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  try {
    const { slug } = await params;
    const supabase = getSupabaseAdmin();

    // Solo campi pubblici (nome/descrizione), stessa esposizione già
    // accettata da company-info/comandi-branding per la landing pubblica:
    // nessun dato sensibile, nessuna scrittura.
    const { data: app } = await supabase
      .from('apps')
      .select('name, config')
      .eq('slug', slug)
      .single();

    if (!app) {
      return { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION };
    }

    // Non fidarsi ciecamente della forma di `config`: viene da pipeline
    // diverse (Creator gestionale/sito, Totalum legacy), con campi opzionali
    // e talvolta annidati sotto `blueprint` (stessa cautela già usata da
    // extractSector in AppLayoutClient).
    const config = app.config as
      | { appName?: unknown; description?: unknown; blueprint?: { description?: unknown } }
      | null;

    const rawTitle = app.name || config?.appName;
    const rawDescription = config?.description || config?.blueprint?.description;

    const title = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle.trim() : DEFAULT_TITLE;
    const description =
      typeof rawDescription === 'string' && rawDescription.trim() ? rawDescription.trim() : DEFAULT_DESCRIPTION;

    return { title, description };
  } catch (err) {
    console.error('[a/[slug]/layout] generateMetadata error:', err);
    return { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION };
  }
}

export default function AppLayout({ children }: PropsWithChildren) {
  return <AppLayoutClient>{children}</AppLayoutClient>;
}
