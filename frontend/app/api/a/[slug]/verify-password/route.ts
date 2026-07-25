import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const body = await req.json();
    const { password } = body;

    if (!password) {
      return NextResponse.json({ error: 'Password obbligatoria' }, { status: 400 });
    }

    const { data: app, error } = await supabase
      .from('apps')
      .select('id, client_password, client_active, expires_at, config')
      .eq('slug', slug)
      .single();

    if (error || !app) {
      return NextResponse.json({ error: 'App non trovata' }, { status: 404 });
    }

    if (!app.client_active) {
      return NextResponse.json({ error: 'App bloccata', blocked: true }, { status: 403 });
    }

    if (app.client_password !== password) {
      return NextResponse.json({ error: 'Password errata' }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      app: {
        id: app.id,
        name: (app.config as { appName?: string } | null)?.appName || '',
        config: app.config,
        expires_at: app.expires_at,
      },
    });
  } catch (err) {
    console.error('[verify-password] error:', err);
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }
}
