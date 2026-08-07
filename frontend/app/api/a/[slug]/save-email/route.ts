import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Body della richiesta non è JSON valido' }, { status: 400 });
    }
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email e password obbligatorie' }, { status: 400 });
    }

    const { data: app, error } = await supabase
      .from('apps')
      .select('id, client_password, client_active, expires_at')
      .eq('slug', slug)
      .single();

    if (error || !app) {
      return NextResponse.json({ error: 'App non trovata' }, { status: 404 });
    }

    if (app.client_password !== password) {
      return NextResponse.json({ error: 'Password errata' }, { status: 401 });
    }

    const { error: updateError } = await supabase
      .from('apps')
      .update({ client_email: email })
      .eq('id', app.id);

    if (updateError) {
      console.error('[save-email] update error:', updateError);
      return NextResponse.json({ error: 'Errore salvataggio email' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[save-email] error:', err);
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }
}
