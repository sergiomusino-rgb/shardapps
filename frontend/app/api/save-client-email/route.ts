import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { cookies } from 'next/headers';

export async function POST(request: Request) {
  try {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Body della richiesta non è JSON valido' }, { status: 400 });
    }
    const { slug, email } = body;

    if (!slug || !email) {
      return NextResponse.json(
        { error: 'Slug e email richiesti' },
        { status: 400 }
      );
    }

    const cookieStore = await cookies();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    // @supabase/ssr@0.6.0 non gestisce correttamente il campo `__InternalSupabase`
    // dei tipi generati (vedi src/lib/supabase-server.ts per il dettaglio):
    // cast verso SupabaseClient<Database> invece del generico di createServerClient.
    const supabase = createServerClient(supabaseUrl, supabaseServiceKey, {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set() {},
        remove() {},
      },
    }) as unknown as SupabaseClient<Database>;

    // Find app by slug and update email
    const { error } = await supabase
      .from('apps')
      .update({ client_email: email })
      .eq('slug', slug);

    if (error) {
      console.error('Error saving email:', error);
      return NextResponse.json(
        { error: 'Errore nel salvataggio dell\'email' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Unexpected error:', err);
    return NextResponse.json(
      { error: 'Errore interno' },
      { status: 500 }
    );
  }
}
