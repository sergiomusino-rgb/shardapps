'use server';

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { z } from 'zod';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ─── Types ────────────────────────────────────────────────────────────────────

const ConfirmOrderItemSchema = z.object({
  product_id: z.uuid().nullable(),
  sku: z.string().nullable(),
  product_name: z.string().min(1),
  unit_price: z.number().nonnegative(),
  quantity: z.number().positive(),
  unit: z.string().min(1),
});

const ConfirmOrderInputSchema = z.object({
  customer_name: z.string().nullable().optional(),
  customer_phone: z.string().nullable().optional(),
  audio_transcript: z.string().nullable().optional(),
  confidence_score: z.number().min(0).max(1).nullable().optional(),
  notes: z.string().nullable().optional(),
  items: z.array(ConfirmOrderItemSchema).min(1, 'L\'ordine deve contenere almeno una riga'),
  // Access token della sessione Supabase corrente (supabaseBrowser.auth.getSession()).
  // L'app non usa createBrowserClient di @supabase/ssr, quindi la sessione
  // vive solo in localStorage lato client: la Server Action non può
  // derivarla dai cookie (sarebbero sempre vuoti) e deve validare questo
  // token esplicitamente con supabase.auth.getUser(accessToken).
  accessToken: z.string().min(1),
});

export type ConfirmOrderInput = z.infer<typeof ConfirmOrderInputSchema>;

export interface ConfirmOrderResult {
  success: boolean;
  orderId?: string;
  error?: string;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ─── Server Action ────────────────────────────────────────────────────────────

export async function confirmOrderAction(input: ConfirmOrderInput): Promise<ConfirmOrderResult> {
  try {
    const validation = ConfirmOrderInputSchema.safeParse(input);
    if (!validation.success) {
      return { success: false, error: validation.error.issues[0]?.message || 'Dati ordine non validi' };
    }
    const { items, customer_name, customer_phone, audio_transcript, confidence_score, notes, accessToken } = validation.data;

    const supabaseAuth = createClient<Database>(supabaseUrl, supabaseAnonKey);
    const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceKey);

    // Stesso principio di sicurezza di extractVoiceOrderAction: tenant_id e
    // agent_id derivano SEMPRE dall'utente risolto dal token di sessione,
    // mai da un valore fornito dal client, altrimenti chiunque potrebbe
    // scrivere ordini nel tenant di qualcun altro chiamando questa Server
    // Action come un endpoint POST.
    let userId: string | undefined;
    try {
      const userResult = await supabaseAuth.auth.getUser(accessToken);
      userId = userResult.data.user?.id || undefined;
    } catch (err) {
      console.error('[confirmOrderAction] Auth error:', err);
    }

    if (!userId) {
      return { success: false, error: 'Devi effettuare il login per salvare un ordine' };
    }

    const { data: membership } = await supabaseAdmin
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', userId)
      .limit(1)
      .single();

    const tenantId = membership?.tenant_id as string | undefined;
    if (!tenantId) {
      return { success: false, error: 'Nessun tenant associato all\'utente. Contatta il supporto.' };
    }

    // Verifica che ogni product_id indicato dal client appartenga davvero al
    // catalogo del tenant, invece di fidarsi ciecamente del payload (che può
    // essere stato manomesso prima dell'invio).
    const requestedProductIds = [...new Set(items.map((i) => i.product_id).filter((id): id is string => !!id))];
    let validProductIds = new Set<string>();
    if (requestedProductIds.length > 0) {
      const { data: catalogRows, error: catalogError } = await supabaseAdmin
        .from('catalog_items')
        .select('id')
        .eq('tenant_id', tenantId)
        .in('id', requestedProductIds);

      if (catalogError) {
        console.error('[confirmOrderAction] Errore verifica catalogo:', catalogError);
        return { success: false, error: 'Errore nella verifica del catalogo prodotti' };
      }
      validProductIds = new Set((catalogRows || []).map((row) => row.id as string));
    }

    // Prezzo, quantità e subtotale sono ricalcolati lato server: il client
    // può solo scegliere cosa includere/rimuovere, non i valori economici.
    const sanitizedItems = items.map((item) => ({
      product_id: item.product_id && validProductIds.has(item.product_id) ? item.product_id : null,
      sku: item.sku,
      product_name: item.product_name,
      unit_price: round2(item.unit_price),
      quantity: item.quantity,
      unit: item.unit,
      subtotal: round2(item.unit_price * item.quantity),
    }));

    const totalAmount = round2(sanitizedItems.reduce((sum, item) => sum + item.subtotal, 0));

    const { data: newOrder, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        tenant_id: tenantId,
        customer_name: customer_name || null,
        customer_phone: customer_phone || null,
        agent_id: userId,
        status: 'CONFIRMED',
        total_amount: totalAmount,
        audio_transcript: audio_transcript || null,
        confidence_score: confidence_score ?? null,
        notes: notes || null,
      })
      .select('id')
      .single();

    if (orderError || !newOrder) {
      console.error('[confirmOrderAction] Errore creazione ordine:', orderError);
      return { success: false, error: 'Errore nella creazione dell\'ordine: ' + (orderError?.message || 'unknown') };
    }

    const orderItemsPayload = sanitizedItems.map((item) => ({
      tenant_id: tenantId,
      order_id: newOrder.id,
      product_id: item.product_id,
      product_name: item.product_name,
      unit_price: item.unit_price,
      quantity: item.quantity,
      unit: item.unit,
      subtotal: item.subtotal,
    }));

    const { error: itemsError } = await supabaseAdmin.from('order_items').insert(orderItemsPayload);

    if (itemsError) {
      console.error('[confirmOrderAction] Errore creazione righe ordine:', itemsError);
      // Rollback: elimina l'ordine appena creato per non lasciare un ordine senza righe
      await supabaseAdmin.from('orders').delete().eq('id', newOrder.id);
      return { success: false, error: 'Errore nel salvataggio delle righe ordine: ' + itemsError.message };
    }

    return { success: true, orderId: newOrder.id as string };
  } catch (err) {
    console.error('[confirmOrderAction] Unexpected error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Errore sconosciuto',
    };
  }
}
