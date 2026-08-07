import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getSupabaseAdmin() {
  return createClient<Database>(supabaseUrl, supabaseServiceKey);
}

// GET /api/a/[slug] - Get app info (for settings and success page)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    
    if (!token) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 });
    }

    // Verifica l'utente
    const authClient = createClient<Database>(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Utente non autenticato' }, { status: 401 });
    }

    // Recupera i dati dell'app direttamente da Supabase
    const supabase = getSupabaseAdmin();
    const { data: app, error: appError } = await supabase
      .from('apps')
      .select('id, name, slug, tenant_id, client_email, client_password, status, trial_ends_at, expires_at')
      .eq('slug', slug)
      .single();

    if (appError || !app) {
      return NextResponse.json({ error: 'App non trovata' }, { status: 404 });
    }

    // Questa route usa la service_role key (bypassa RLS): senza questo
    // controllo qualunque utente ShardApps autenticato — non solo il proprietario
    // del tenant — poteva leggere client_email/client_password in chiaro di
    // QUALSIASI app conoscendone lo slug (vedi audit pre-lancio).
    const { data: membership } = await supabase
      .from('tenant_members')
      .select('tenant_id')
      .eq('tenant_id', app.tenant_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 });
    }

    return NextResponse.json({
      id: app.id,
      name: app.name,
      slug: app.slug,
      client_email: app.client_email,
      client_password: app.client_password,
      status: app.status,
      trial_ends_at: app.trial_ends_at,
      expires_at: app.expires_at
    });
  } catch (error) {
    console.error('Error fetching app info:', error);
    return NextResponse.json(
      { error: 'Errore di connessione al server' },
      { status: 500 }
    );
  }
}

// POST /api/a/[slug] - Client login with password
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Body della richiesta non è JSON valido' }, { status: 400 });
    }
    const { password } = body;

    if (!password) {
      return NextResponse.json({ error: 'Password richiesta' }, { status: 400 });
    }

    const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
    const response = await fetch(`${BACKEND_URL}/api/a/${slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error proxying login:', error);
    return NextResponse.json(
      { error: 'Errore di connessione al server' },
      { status: 500 }
    );
  }
}