import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

// ============================================================================
// Supabase Admin Client
// ============================================================================

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceKey);

// Admin user ID
const ADMIN_USER_ID = 'd3eda57f-692a-4904-ac5f-93bdaaec8ce5';

// ============================================================================
// Helper: Verify admin
// ============================================================================

async function verifyAdmin(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.substring(7);
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  
  if (!user) return false;
  
  // Check if user is admin by ID
  if (user.id === ADMIN_USER_ID) return true;
  
  // Check if user has admin role in profile
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single();
  
  return profile?.role === 'admin';
}

// ============================================================================
// Helper: Send takeover notification email
// ============================================================================

async function sendTakeoverNotification(userEmail: string, appName: string): Promise<void> {
  // Using Resend API (recommended) or fallback to console log
  const resendApiKey = process.env.RESEND_API_KEY;
  
  if (resendApiKey) {
    try {
      const response = await fetch('https://api.resend.com/v1/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'ShardApps <noreply@zeusx.it>',
          to: [userEmail],
          subject: 'Servizio ShardApps - Aggiornamento Gestione',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #1e293b;">Gentile utente,</h2>
              <p>Il tuo servizio <strong>${appName}</strong> è ora gestito direttamente da ShardApps.</p>
              <p>Non è richiesta alcuna azione, il servizio continuerà senza interruzioni.</p>
              <p style="color: #64748b; font-size: 14px; margin-top: 20px;">
                ShardApps Team<br>
                Questo messaggio è stato inviato automaticamente.
              </p>
            </div>
          `,
        }),
      });
      
      if (!response.ok) {
        console.error('Failed to send email:', await response.text());
      }
    } catch (error) {
      console.error('Email send error:', error);
    }
  } else {
    // Fallback: log the notification (for development)
    console.log(`[TAKEOVER NOTIFICATION] To: ${userEmail}, App: ${appName}`);
    console.log('Gentile utente, il tuo servizio è ora gestito direttamente da ShardApps. Non è richiesta alcuna azione, il servizio continuerà senza interruzioni.');
  }
}

// ============================================================================
// API Handler - GET: Get app details for confirmation
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    // Verify admin
    if (!await verifyAdmin(request)) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get app ID from query params
    const { searchParams } = new URL(request.url);
    const appId = searchParams.get('app_id');

    if (!appId) {
      return NextResponse.json(
        { error: 'app_id parameter required' },
        { status: 400 }
      );
    }

    // Get app details from apps table
    const { data, error } = await supabaseAdmin
      .from('apps')
      .select('id, name, totalum_app_id, tenant_id, stripe_connect_id, is_managed_by_platform, client_subscription_price, status')
      .eq('id', appId)
      .single();

    if (error) {
      console.error('[admin/takeover GET] Supabase error:', error);
      return NextResponse.json(
        { error: 'Errore nel recupero dei dati' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: data || null });
  } catch (error) {
    console.error('Error fetching app for takeover:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ============================================================================
// API Handler - POST: Execute takeover
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // Verify admin
    if (!await verifyAdmin(request)) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Body della richiesta non è JSON valido' }, { status: 400 });
    }
    const { app_id } = body;

    if (!app_id) {
      return NextResponse.json(
        { error: 'app_id is required' },
        { status: 400 }
      );
    }

    // Get app details first
    const { data: appData, error: appError } = await supabaseAdmin
      .from('apps')
      .select('id, name, tenant_id, stripe_connect_id, is_managed_by_platform')
      .eq('id', app_id)
      .single();

    if (appError || !appData) {
      return NextResponse.json(
        { error: 'App non trovata' },
        { status: 404 }
      );
    }

    // Se l'app ha stripe_connect_id, dobbiamo cancellare eventuali abbonamenti attivi
    // e impostare un flag per farli riattivare sul nuovo sistema
    if (appData.stripe_connect_id) {
      try {
        // Recupera tutte le subscription attive per questo account connesso
        // Nota: dobbiamo cercare nelle subscription collegate al nostro account principale
        // che hanno application_fee per questo stripe_connect_id
        
        // Per ora, segnaliamo che l'app ha bisogno di reset pagamento
        // Il cliente dovrà riattivare l'abbonamento al prossimo accesso
        await supabaseAdmin
          .from('apps')
          .update({
            is_managed_by_platform: true,
            payment_reset_required: true,
            updated_at: new Date().toISOString()
          })
          .eq('id', app_id);
      } catch (stripeError) {
        console.error('Error during Stripe cleanup:', stripeError);
        // Continuiamo comunque con il takeover
      }
    }

    // Set is_managed_by_platform to TRUE
    const { error } = await supabaseAdmin
      .from('apps')
      .update({
        is_managed_by_platform: true,
        payment_reset_required: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', app_id)
      .select('id, name, totalum_app_id')
      .single();

    if (error) {
      console.error('[admin/takeover] Supabase error:', error);
      return NextResponse.json(
        { error: 'Errore nell\'aggiornamento' },
        { status: 500 }
      );
    }

    // Get user email for notification
    const { data: tenantData } = await supabaseAdmin
      .from('tenants')
      .select('owner_id')
      .eq('id', appData.tenant_id)
      .single();

    if (tenantData?.owner_id) {
      const { data: userData } = await supabaseAdmin.auth.getUser(tenantData.owner_id);
      if (userData?.user?.email) {
        await sendTakeoverNotification(userData.user.email, appData.name);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'App messa in gestione diretta da ShardApps',
      app_name: appData.name,
      app_id: appData.id,
      is_managed_by_platform: true
    });
  } catch (error) {
    console.error('Error executing takeover:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}