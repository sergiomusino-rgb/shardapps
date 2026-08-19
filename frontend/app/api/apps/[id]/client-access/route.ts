import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { NextResponse } from 'next/server';
import { hashPassword } from '@/src/lib/password-hash';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < 10; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    // Verifica autenticazione ShardApps: la sessione utente vive in localStorage
    // (non in cookie), quindi il client invia il token via header Authorization
    // come nel resto delle route sotto /api/apps/[id].
    const authHeader = req.headers.get('authorization');
    const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!accessToken) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 });
    }

    const authClient = createClient<Database>(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Body della richiesta non è JSON valido' }, { status: 400 });
    }
    const { action } = body;

    // Verifica che l'app appartenga al tenant dell'utente
    const { data: app, error: appError } = await supabase
      .from('apps')
      .select('id, tenant_id, client_password, client_active, expires_at')
      .eq('id', id)
      .single();

    if (appError || !app) {
      return NextResponse.json({ error: 'App non trovata' }, { status: 404 });
    }

    // Verifica ownership tramite tenant_members
    const { data: membership } = await supabase
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', user.id)
      .eq('tenant_id', app.tenant_id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 });
    }

    let result: any = {};

    if (action === 'toggle') {
      // Inverte stato client_active
      const newActive = !app.client_active;
      const { error } = await supabase
        .from('apps')
        .update({ client_active: newActive })
        .eq('id', id);

      if (error) {
        return NextResponse.json({ error: 'Errore aggiornamento stato' }, { status: 500 });
      }
      result = { success: true, client_active: newActive };

    } else if (action === 'regenerate-password') {
      // Genera nuova password casuale
      const newPassword = generatePassword();
      // Pre-Beta Hardening, Blocco 6: client_password (usato per il
      // confronto ad ogni login) viene hashato; initial_password resta
      // VOLUTAMENTE in chiaro — è la copia mostrata al reseller per la
      // consegna al cliente, mai usata per autenticare. new_password nella
      // risposta resta in chiaro: è l'unico momento legittimo per mostrarla.
      const hashedPassword = await hashPassword(newPassword);
      const { error } = await supabase
        .from('apps')
        .update({
          client_password: hashedPassword,
          initial_password: newPassword,
        })
        .eq('id', id);

      if (error) {
        return NextResponse.json({ error: 'Errore rigenerazione password' }, { status: 500 });
      }

      // Stessa scrittura anche in app_credentials (fonte primaria per
      // getClientCredentials/verifyLegacyPassword — vedi lib/client-auth.js):
      // senza questo upsert, un'app con già una riga app_credentials
      // continuerebbe a fare login con la vecchia password anche dopo la
      // rigenerazione, perché app_credentials ha priorità su apps.client_password.
      await supabase
        .from('app_credentials')
        .upsert({ app_id: id, client_password: hashedPassword }, { onConflict: 'app_id' });

      result = { success: true, new_password: newPassword };

    } else if (action === 'extend-expiry') {
      // Estendi scadenza di 30 giorni dalla scadenza attuale o da oggi
      const currentExpiry = app.expires_at ? new Date(app.expires_at) : new Date();
      const newExpiry = new Date(currentExpiry);
      if (newExpiry < new Date()) {
        // Se già scaduta, estendi da oggi
        newExpiry.setTime(Date.now());
      }
      newExpiry.setDate(newExpiry.getDate() + 30);

      const { error } = await supabase
        .from('apps')
        .update({
          expires_at: newExpiry.toISOString(),
          client_active: true,
          expiry_warning_sent: false,
        })
        .eq('id', id);

      if (error) {
        return NextResponse.json({ error: 'Errore estensione scadenza' }, { status: 500 });
      }
      result = { success: true, new_expires_at: newExpiry.toISOString() };

    } else {
      return NextResponse.json({ error: 'Azione non valida' }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('[client-access] error:', err);
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 });
  }
}
