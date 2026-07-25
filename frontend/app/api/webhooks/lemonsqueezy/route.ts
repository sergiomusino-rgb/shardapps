import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import crypto from 'crypto';

// ============================================================================
// Mappa piani -> slot
// ============================================================================
const PLAN_SLOTS: Record<string, number> = {
  free: 0,
  starter: 1,
  pro: 5,
  business: 100,
};

// ============================================================================
// Supabase Admin Client
// ============================================================================

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceKey);

// ============================================================================
// LemonSqueezy Configuration
// ============================================================================

const WEBHOOK_SECRET = process.env.LEMONSQUEEZY_WEBHOOK_SECRET || '';

// ============================================================================
// Helper: Verify webhook signature
// ============================================================================

function verifyWebhookSignature(payload: string, signature: string): boolean {
  if (!WEBHOOK_SECRET) {
    console.warn('LEMONSQUEEZY_WEBHOOK_SECRET not set, skipping signature verification');
    return true; // Skip in development
  }

  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');

  return signature === expectedSignature;
}

// ============================================================================
// Helper: Process subscription payment success
// ============================================================================

async function processSubscriptionPayment(event: any) {
  const { data: attributes } = event;
  
  if (!attributes) {
    throw new Error('Invalid event data');
  }

  // Estrai l'importo totale
  const totalAmount = parseFloat(attributes.total) / 100; // LemonSqueezy usa centesimi
  
  // Estrai custom_data per trovare l'app
  const customData = attributes.custom || {};
  const appRegistryId = customData.app_registry_id || customData.app_id;
  const resellerId = customData.reseller_id;

  // Se non c'è app_registry_id, prova a cercarlo tramite product_id
  let finalAppRegistryId = appRegistryId;
  let finalResellerId = resellerId;

  if (!finalAppRegistryId && attributes.product_id) {
    // Cerca l'app nel registry in base al product_id
    const { data: app } = await supabaseAdmin
      .from('app_registry')
      .select('id, reseller_id')
      .eq('lemon_squeezy_product_id', attributes.product_id)
      .single();
    
    if (app) {
      finalAppRegistryId = app.id;
      finalResellerId = app.reseller_id;
    }
  }

  if (!finalAppRegistryId || !finalResellerId) {
    throw new Error('Could not identify app or reseller from webhook data');
  }

  // Calcola la commissione ZEUSX (50€ fissi)
  const zeusxCommission = 50.00;

  // Registra la transazione
  const { error: transactionError } = await supabaseAdmin
    .from('transactions')
    .insert({
      app_registry_id: finalAppRegistryId,
      reseller_id: finalResellerId,
      event_type: 'subscription_payment_success',
      event_id: event.id?.toString(),
      total_amount: totalAmount,
      zeusx_commission: zeusxCommission,
      currency: attributes.currency || 'EUR',
      status: 'completed',
      metadata: {
        event_data: event,
        customer_email: attributes.user_email,
        product_id: attributes.product_id,
      },
    });

  if (transactionError) {
    throw transactionError;
  }

  // Aggiorna lo stato dell'app: is_active = true, expires_at + 30 giorni
  const newExpiryDate = new Date();
  newExpiryDate.setDate(newExpiryDate.getDate() + 30);

  const { error: appError } = await supabaseAdmin
    .from('app_registry')
    .update({
      is_active: true,
      expires_at: newExpiryDate.toISOString(),
      status: 'active',
    })
    .eq('id', finalAppRegistryId);

  if (appError) {
    console.error('Error updating app status:', appError);
  }

  // ─── AGGIORNA TABELLA TENANTS ─────────────────────────────────────────────
  // Trova il tenant associato al reseller
  const { data: membership } = await supabaseAdmin
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', finalResellerId)
    .single();

  if (membership?.tenant_id) {
    // Determina il piano in base all'importo pagato (o usa un default)
    const planName = attributes.variant_name?.toLowerCase() || 'pro';
    const slots = PLAN_SLOTS[planName] || PLAN_SLOTS.pro;

    const { data: currentTenant } = await supabaseAdmin
      .from('tenants')
      .select('plan, app_limit')
      .eq('id', membership.tenant_id)
      .single();

    if (currentTenant) {
      const newAppLimit = Math.max(currentTenant.app_limit || 0, slots);

      await supabaseAdmin
        .from('tenants')
        .update({
          plan: planName,
          app_limit: newAppLimit,
          updated_at: new Date().toISOString(),
        })
        .eq('id', membership.tenant_id);

      console.log(`[Webhook] Tenant ${membership.tenant_id} aggiornato: plan=${planName}, app_limit=${newAppLimit}`);
    }
  }

  return { success: true, appRegistryId: finalAppRegistryId };
}

// ============================================================================
// Webhook Handler
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // Get signature from header
    const signature = request.headers.get('x-signature') || '';
    
    // Get raw body
    const payload = await request.text();
    
    // Verify signature
    if (!verifyWebhookSignature(payload, signature)) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    // Parse JSON
    const event = JSON.parse(payload);
    
    // Handle different event types
    const eventType = event.meta?.event_name || event.type;

    switch (eventType) {
      case 'subscription_payment_success':
        await processSubscriptionPayment(event.data || event);
        break;
      
      case 'subscription_created':
        // Gestione creazione abbonamento
        console.log('Subscription created:', event.data?.id);
        break;
      
      case 'subscription_cancelled':
        // Gestione cancellazione abbonamento
        console.log('Subscription cancelled:', event.data?.id);
        break;
      
      default:
        console.log(`Unhandled event type: ${eventType}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET handler for webhook verification
// ============================================================================

export async function GET(request: NextRequest) {
  const challenge = request.nextUrl.searchParams.get('challenge');
  
  if (challenge) {
    return new NextResponse(challenge);
  }
  
  return NextResponse.json({ status: 'webhook endpoint active' });
}