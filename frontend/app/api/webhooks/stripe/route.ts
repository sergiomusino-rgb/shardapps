import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-06-24.dahlia',
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

function getSupabase() {
  return createClient<Database>(supabaseUrl, supabaseServiceKey);
}

/**
 * Mappa i piani agli slot da aggiungere (cumulativo)
 * - free: 0 slot
 * - starter: +1 slot
 * - pro: +5 slot
 * - business: +20 slot
 * - credit_topup ("Ricarica Extra"): 0 slot, solo crediti (vedi getCreditsForPlan)
 */
function getSlotsForPlan(planId: string): number {
  const slotsMap: Record<string, number> = {
    free: 0,
    starter: 1,
    pro: 5,
    business: 50,
    credit_topup: 0,
  };
  return slotsMap[planId] || 0;
}

/**
 * Mappa i piani ai crediti Vision da accreditare (cumulativo, come gli slot).
 * I piani base includono un pacchetto di crediti al setup; "credit_topup"
 * (bottone "Ricarica Extra" in pricing, ex "Slot Extra") accredita solo
 * crediti senza toccare gli slot app.
 */
function getCreditsForPlan(planId: string): number {
  const creditsMap: Record<string, number> = {
    free: 0,
    starter: 20,
    pro: 100,
    business: 500,
    credit_topup: 50,
  };
  return creditsMap[planId] || 0;
}

// Rango dei piani: gli eventi Stripe non arrivano garantiti in ordine
// cronologico. Se un tenant compra business e poi arriva in ritardo l'evento
// del vecchio acquisto starter, un update incondizionato di tenants.plan lo
// farebbe retrocedere. Si applica solo un piano pari o superiore a quello
// già salvato.
const PLAN_RANK: Record<string, number> = { free: 0, starter: 1, pro: 2, business: 3 };
function planRank(plan: string | null | undefined): number {
  return PLAN_RANK[plan ?? ''] ?? 0;
}

/**
 * POST /api/webhooks/stripe
 * Webhook per ricevere eventi da Stripe (da account connessi)
 * Gestisce checkout.session.completed e invoice.paid
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      return NextResponse.json({ error: 'Signature mancante' }, { status: 400 });
    }

    let event: Stripe.Event;

    // Verifica la firma del webhook
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      console.error('[Stripe Webhook] Firma non valida:', err);
      return NextResponse.json({ error: 'Webhook signature verification failed' }, { status: 400 });
    }

    const supabase = getSupabase();

    // Gestisci gli eventi di interesse
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event, supabase);
        break;
      
      case 'invoice.paid':
        await handleInvoicePaid(event, supabase);
        break;
      
      case 'invoice.payment_failed':
        // Prima controlla se è un pagamento fallito di un'App cliente
        // Poi controlla se è un pagamento fallito di un User (subscription)
        await handlePaymentFailed(event, supabase);
        break;
      
      case 'customer.subscription.updated':
        // Sync stato app-cliente (past_due/active) sui cambi di stato Stripe
        // (es. carta scaduta poi rinnovata) per le subscription del paywall trial.
        await handleAppSubscriptionUpdated(event, supabase);
        break;

      case 'customer.subscription.deleted':
      case 'customer.subscription.paused':
        // User ha cancellato o messo in pausa il proprio abbonamento a ZeusX
        await handleUserSubscriptionCancelled(event, supabase);
        break;
      
      case 'account.application.deauthorized':
        await handleOAuthDeauthorized(event, supabase);
        break;
      
      default:
        console.log(`[Stripe Webhook] Evento ignorato: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[Stripe Webhook] Errore:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Errore webhook' },
      { status: 500 }
    );
  }
}

/**
 * Gestisce il successo di un checkout session
 * Aggiorna lo stato dell'app o aggiunge gli slot in base al tipo
 */
async function handleCheckoutSessionCompleted(event: Stripe.Event, supabase: any) {
  const data = event.data.object as any;

  // Caso 0: Abbonamento mensile dell'app-cliente dopo scadenza trial (paywall
  // TrialPaywallModal / banner trial) — creato da
  // /api/a/[slug]/create-checkout-session con metadata.app_id = apps.id.
  const appId: string | null = data.metadata?.app_id ?? null;
  if (appId) {
    await activateAppSubscription(appId, data.subscription ?? null, supabase);
    return;
  }

  // Estrai totalum_app_id dai metadata (pagamento per app cliente)
  let totalum_app_id: string | null = null;
  let planId: string | null = null;
  let tenantId: string | null = null;
  let supabaseUserId: string | null = null;

  if (data.metadata) {
    totalum_app_id = data.metadata.totalum_app_id ?? null;
    planId = data.metadata.plan_id ?? null;
    tenantId = data.metadata.tenant_id ?? null;
    supabaseUserId = data.metadata.supabase_user_id ?? null;
  }

  // Caso 1: Pagamento per un'app cliente (Stripe Connect)
  if (totalum_app_id) {
    const { error } = await supabase
      .from('apps')
      .update({ 
        status: 'active',
        updated_at: new Date().toISOString()
      })
      .eq('totalum_app_id', totalum_app_id);

    if (error) {
      console.error('[Stripe Webhook] Errore aggiornamento stato app:', error);
    } else {
      console.log(`[Stripe Webhook] App ${totalum_app_id} impostata a 'active'`);
    }
    return;
  }
  
  // Caso 2: Pagamento per un piano/utente (aggiungi slot e/o crediti Vision)
  if (planId && tenantId) {
    const slotsToAdd = getSlotsForPlan(planId);
    const creditsToAdd = getCreditsForPlan(planId);

    if (slotsToAdd > 0 || creditsToAdd > 0) {
      // Questo evento arriva anche al webhook del backend
      // (backend/server.js, registrato separatamente su Render): entrambi
      // sono abilitati su checkout.session.completed. La riga in
      // processed_checkout_sessions fa da guardia di idempotenza condivisa
      // tra i due: solo chi riesce a inserirla per primo somma slot/crediti
      // (via RPC atomiche add_tenant_slots/grant_credits), l'altro diventa
      // no-op.
      const sessionId: string | undefined = data.id;
      const { error: insertError } = await supabase
        .from('processed_checkout_sessions')
        .insert({ session_id: sessionId, tenant_id: tenantId, plan: planId, slots_added: slotsToAdd });

      if (insertError && insertError.code !== '23505') {
        console.error('[Stripe Webhook] Errore idempotenza:', insertError);
      } else if (!insertError) {
        // Crediti Vision: legati all'utente che ha pagato (profiles.user_id),
        // non al tenant/workspace — coerente con come vengono spesi in
        // /api/generate-video. Se manca supabase_user_id nei metadata (non
        // dovrebbe succedere, create-checkout-session lo imposta sempre) si
        // salta l'accredito invece di far fallire l'intero webhook: gli slot
        // vanno comunque a buon fine sotto.
        if (creditsToAdd > 0 && supabaseUserId) {
          const { error: creditsError } = await supabase.rpc('grant_credits', {
            p_user_id: supabaseUserId,
            p_amount: creditsToAdd,
            p_type: 'purchase',
            p_description: `Acquisto piano ${planId}`,
            p_reference_id: sessionId ?? null,
            p_metadata: { plan_id: planId, session_id: sessionId ?? null },
          });

          if (creditsError) {
            console.error('[Stripe Webhook] Errore accredito crediti Vision:', creditsError);
          } else {
            console.log(`[Stripe Webhook] Accreditati ${creditsToAdd} crediti Vision a utente ${supabaseUserId} per piano ${planId}`);
          }
        } else if (creditsToAdd > 0) {
          console.error(`[Stripe Webhook] Impossibile accreditare crediti per piano ${planId}: supabase_user_id mancante nei metadata (session ${sessionId})`);
        }

        if (slotsToAdd === 0) {
          // credit_topup ("Ricarica Extra"): nessuno slot da aggiungere,
          // niente altro da fare per questa sessione.
          return;
        }

        const { error: rpcError } = await supabase.rpc('add_tenant_slots', {
          tenant_id: tenantId,
          slots_to_add: slotsToAdd,
        });

        if (rpcError) {
          console.error('[Stripe Webhook] Errore aggiunta slot:', rpcError);
        } else {
          const { data: currentTenant } = await supabase
            .from('tenants')
            .select('plan')
            .eq('id', tenantId)
            .single();

          if (planRank(planId) >= planRank(currentTenant?.plan)) {
            const { error: planError } = await supabase
              .from('tenants')
              .update({ plan: planId, updated_at: new Date().toISOString() })
              .eq('id', tenantId);

            if (planError) {
              console.error('[Stripe Webhook] Errore aggiornamento piano:', planError);
            } else {
              console.log(`[Stripe Webhook] Aggiunti ${slotsToAdd} slot al tenant ${tenantId} per piano ${planId}`);
            }
          } else {
            console.log(`[Stripe Webhook] piano ${planId} non applicato: tenant ${tenantId} ha già ${currentTenant?.plan}`);
          }
        }
      } else {
        console.log(`[Stripe Webhook] sessione ${sessionId} già processata, skip`);
      }
    }

    // Aggiorna o crea la subscription
    const customerId = data.customer;
    const subscriptionId = data.subscription;

    if (customerId) {
      const { data: existingSub } = await supabase
        .from('subscriptions')
        .select('id, stripe_subscription_id')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (existingSub) {
        await supabase
          .from('subscriptions')
          .update({
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            status: 'active',
            updated_at: new Date().toISOString()
          })
          .eq('tenant_id', tenantId);
      } else {
        await supabase
          .from('subscriptions')
          .insert({
            tenant_id: tenantId,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            status: 'active'
          });
      }
    }
  }
}

/**
 * Gestisce il pagamento di una fattura
 * Aggiorna lo stato dell'app a 'active'
 */
async function handleInvoicePaid(event: Stripe.Event, supabase: any) {
  const data = event.data.object as any;

  // Rinnovo mensile della subscription app-cliente (paywall trial): conferma
  // status 'active' — copre anche il caso di un ritorno da 'past_due'.
  const subscriptionId: string | null = data.subscription ?? null;
  if (subscriptionId) {
    const { data: app } = await supabase
      .from('apps')
      .select('id')
      .eq('stripe_subscription_id', subscriptionId)
      .maybeSingle();
    if (app) {
      await activateAppSubscription(app.id, subscriptionId, supabase);
      return;
    }
  }

  // Estrai totalum_app_id dai metadata
  let totalum_app_id: string | null = null;

  if (data.metadata) {
    totalum_app_id = data.metadata.totalum_app_id ?? null;
  }

  // Per le fatture, controlla anche le line items
  if (!totalum_app_id && data.lines?.data?.[0]?.price?.metadata) {
    totalum_app_id = data.lines.data[0].price.metadata.totalum_app_id ?? null;
  }

  if (totalum_app_id) {
    // Aggiorna lo stato dell'app a 'active'
    return;
  }

  // Legacy: takeover automatico app di un reseller/tenant per mancato
  // pagamento del proprio abbonamento a ZeusX (non correlato al paywall
  // trial dell'app-cliente gestito sopra). Questo ramo richiede
  // subscription.tenant_id da una fonte non presente in questo evento — se
  // in futuro va ripristinato va prima ricostruito da dove recuperare il
  // tenant (es. da data.customer via lookup su `subscriptions`).
  console.log('[Stripe Webhook] invoice.paid non riconducibile a nessuna app cliente, ignorato');
}

/**
 * Attiva (o riattiva) l'abbonamento mensile di un'app-cliente dopo un
 * checkout/rinnovo riuscito: sblocca il TrialPaywallModal.
 */
async function activateAppSubscription(appId: string, subscriptionId: string | null, supabase: any) {
  const update: Record<string, unknown> = { status: 'active', updated_at: new Date().toISOString() };
  if (subscriptionId) update.stripe_subscription_id = subscriptionId;

  const { error } = await supabase.from('apps').update(update).eq('id', appId);

  if (error) {
    console.error(`[Stripe Webhook] Errore attivazione app ${appId}:`, error);
  } else {
    console.log(`[Stripe Webhook] App ${appId} attivata (subscription ${subscriptionId ?? 'n/d'})`);
  }
}

/**
 * customer.subscription.updated: sincronizza lo stato dell'app-cliente sui
 * cambi di stato della subscription Stripe (es. torna 'active' dopo un
 * pagamento riprovato con successo, o passa a 'past_due').
 */
async function handleAppSubscriptionUpdated(event: Stripe.Event, supabase: any) {
  const sub = event.data.object as Stripe.Subscription;

  const statusMap: Record<string, 'active' | 'past_due' | 'canceled'> = {
    active: 'active',
    trialing: 'active',
    past_due: 'past_due',
    unpaid: 'past_due',
    incomplete: 'past_due',
    incomplete_expired: 'canceled',
    canceled: 'canceled',
  };
  const newStatus = statusMap[sub.status];
  if (!newStatus) return;

  const { data: app } = await supabase
    .from('apps')
    .select('id')
    .eq('stripe_subscription_id', sub.id)
    .maybeSingle();

  // Non è la subscription di un'app cliente (es. abbonamento reseller a
  // ZeusX): ignorato, non è di competenza di questo handler.
  if (!app) return;

  const { error } = await supabase
    .from('apps')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', app.id);

  if (error) console.error(`[Stripe Webhook] Errore sync stato app ${app.id}:`, error);
  else console.log(`[Stripe Webhook] App ${app.id} sincronizzata a '${newStatus}'`);
}

/**
 * invoice.payment_failed: se riconducibile a un'app cliente, la mette in
 * 'past_due' (mostra di nuovo il paywall) e notifica l'admin.
 */
async function handlePaymentFailed(event: Stripe.Event, supabase: any) {
  const data = event.data.object as any;
  const subscriptionId: string | null = data.subscription ?? null;

  if (subscriptionId) {
    const { data: app } = await supabase
      .from('apps')
      .select('id, name')
      .eq('stripe_subscription_id', subscriptionId)
      .maybeSingle();

    if (app) {
      const { error } = await supabase
        .from('apps')
        .update({ status: 'past_due', updated_at: new Date().toISOString() })
        .eq('id', app.id);

      if (error) console.error(`[Stripe Webhook] Errore impostazione past_due app ${app.id}:`, error);
      else console.log(`[Stripe Webhook] App ${app.id} (${app.name}) in 'past_due' (pagamento fallito)`);
      return;
    }
  }

  console.log('[Stripe Webhook] invoice.payment_failed non riconducibile a nessuna app cliente, ignorato');
}

/**
 * customer.subscription.deleted / .paused: se è la subscription di un'app
 * cliente la mette in 'canceled' (ripristina il paywall bloccante).
 */
async function handleUserSubscriptionCancelled(event: Stripe.Event, supabase: any) {
  const sub = event.data.object as Stripe.Subscription;

  const { data: app } = await supabase
    .from('apps')
    .select('id')
    .eq('stripe_subscription_id', sub.id)
    .maybeSingle();

  if (app) {
    const { error } = await supabase
      .from('apps')
      .update({ status: 'canceled', updated_at: new Date().toISOString() })
      .eq('id', app.id);

    if (error) console.error(`[Stripe Webhook] Errore cancellazione app ${app.id}:`, error);
    else console.log(`[Stripe Webhook] App ${app.id} impostata a 'canceled'`);
    return;
  }

  console.log('[Stripe Webhook] customer.subscription.deleted/paused non riconducibile a nessuna app cliente, ignorato');
}

/**
 * account.application.deauthorized: evento Stripe Connect (reseller ha
 * revocato l'accesso OAuth). Non correlato al paywall trial dell'app
 * cliente; nessuna azione automatica implementata, solo log per audit.
 */
async function handleOAuthDeauthorized(event: Stripe.Event, supabase: any) {
  console.log('[Stripe Webhook] account.application.deauthorized ricevuto, nessuna azione automatica implementata');
}

/**
 * Notifica l'admin del takeover automatico
 */
async function notifyAdminTakeover(totalumAppId: string, userEmail: string, reason: string) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@zeusx.it';
  
  if (resendApiKey) {
    try {
      await fetch('https://api.resend.com/v1/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'ZeusX <noreply@zeusx.it>',
          to: [adminEmail],
          subject: `[URGENTE] Takeover automatico app ${totalumAppId}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #ef4444;">Takeover automatico eseguito</h2>
              <p>L'app <strong>${totalumAppId}</strong> è stata messa in gestione diretta da ZeusX.</p>
              <p><strong>Motivo:</strong> ${reason}</p>
              <p><strong>User:</strong> ${userEmail}</p>
              <p style="color: #64748b; font-size: 14px; margin-top: 20px;">
                ZeusX System<br>
                Questo messaggio è stato inviato automaticamente.
              </p>
            </div>
          `,
        }),
      });
    } catch (error) {
      console.error('[Stripe Webhook] Errore invio notifica admin:', error);
    }
  } else {
    // Fallback: log
    console.log(`[ADMIN NOTIFICATION] App ${totalumAppId} takeover per ${reason} (User: ${userEmail})`);
  }
}
