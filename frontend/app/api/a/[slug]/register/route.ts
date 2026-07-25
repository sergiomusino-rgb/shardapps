import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

// ─── POST /api/a/[slug]/register ───────────────────────────────────────────
// Registrazione self-service per il cliente designato di un'app auth_mode
// 'supabase' (nuovo flusso Landing/Login/Register/Dashboard). Modello a
// "singolo account cliente": può registrarsi solo l'email salvata come
// apps.client_email al momento della generazione, ed una sola volta.
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const body = await req.json();
    const email = (body?.email || '').trim();
    const password = body?.password || '';

    if (!email || !password) {
      return NextResponse.json({ error: 'Email e password richieste' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'La password deve avere almeno 8 caratteri' }, { status: 400 });
    }

    const { data: app, error: appError } = await supabase
      .from('apps')
      .select('id, auth_mode, client_email, client_active')
      .eq('slug', slug)
      .single();

    if (appError || !app) {
      return NextResponse.json({ error: 'App non trovata' }, { status: 404 });
    }

    if (app.auth_mode !== 'supabase') {
      return NextResponse.json({ error: 'Questa app non supporta la registrazione' }, { status: 400 });
    }

    if (!app.client_active) {
      return NextResponse.json({ error: 'App bloccata o scaduta' }, { status: 403 });
    }

    if (!app.client_email || app.client_email.toLowerCase() !== email.toLowerCase()) {
      return NextResponse.json(
        { error: 'Questo indirizzo email non è autorizzato per questa app. Contatta chi ti ha fornito l\'accesso.' },
        { status: 403 }
      );
    }

    const { data: existingAdmin } = await supabase
      .from('app_users')
      .select('id')
      .eq('app_id', app.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (existingAdmin) {
      return NextResponse.json({ error: 'Account già registrato, effettua il login.' }, { status: 409 });
    }

    // Crea l'utente Supabase Auth. Se esiste già (tipicamente: l'owner ha
    // usato la propria email come client_email, dato che è il default in
    // creator/generate/route.ts) NON dobbiamo mai impostare/sovrascrivere la
    // password di un account già esistente da un endpoint pubblico non
    // autenticato: sarebbe un modo per dirottare l'account di chiunque
    // conoscendone solo l'email e uno slug con quella email come client_email.
    // Accettiamo quell'account SOLO se la password inviata è già quella
    // corretta (provata con un vero signIn), altrimenti rifiutiamo.
    let userId: string;
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError) {
      const anon = createClient<Database>(supabaseUrl, anonKey, { auth: { persistSession: false } });
      const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({ email, password });

      if (signInError || !signIn.user) {
        return NextResponse.json(
          { error: 'Questo indirizzo email è già associato a un account con un\'altra password. Accedi con le credenziali esistenti.' },
          { status: 409 }
        );
      }
      userId = signIn.user.id;
    } else {
      userId = created.user.id;
    }

    const { error: insertError } = await supabase
      .from('app_users')
      .insert({
        user_id: userId,
        app_id: app.id,
        email,
        role: 'admin',
        is_active: true,
      });

    if (insertError) {
      console.error('[register] app_users insert error:', insertError);
      return NextResponse.json({ error: 'Errore associazione account' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[register] error:', err);
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }
}
