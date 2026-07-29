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

// ─── Aggiornamento stato ordine (conferma/annullamento dal titolare) ──────────
// Usata dalla vista "Storico Ordini" del titolare per approvare o annullare
// gli ordini raccolti dagli agenti (status PENDING_CONFIRMATION).

const UPDATABLE_ORDER_STATUSES = ['CONFIRMED', 'CANCELLED'] as const;

const UpdateOrderStatusInputSchema = z.object({
  orderId: z.uuid(),
  status: z.enum(UPDATABLE_ORDER_STATUSES),
  // Stesso principio di sicurezza delle altre Server Action Comandi: l'app
  // non usa @supabase/ssr, quindi niente cookie di sessione — il token va
  // passato esplicitamente e validato qui con supabase.auth.getUser().
  accessToken: z.string().min(1),
});

export type UpdateOrderStatusInput = z.infer<typeof UpdateOrderStatusInputSchema>;

export interface UpdateOrderStatusResult {
  success: boolean;
  error?: string;
}

export async function updateOrderStatusAction(input: UpdateOrderStatusInput): Promise<UpdateOrderStatusResult> {
  try {
    const validation = UpdateOrderStatusInputSchema.safeParse(input);
    if (!validation.success) {
      return { success: false, error: validation.error.issues[0]?.message || 'Dati non validi' };
    }
    const { orderId, status, accessToken } = validation.data;

    const supabaseAuth = createClient<Database>(supabaseUrl, supabaseAnonKey);
    const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceKey);

    let userId: string | undefined;
    try {
      const userResult = await supabaseAuth.auth.getUser(accessToken);
      userId = userResult.data.user?.id || undefined;
    } catch (err) {
      console.error('[updateOrderStatusAction] Auth error:', err);
    }
    if (!userId) {
      return { success: false, error: 'Devi effettuare il login per aggiornare un ordine' };
    }

    const { data: membership } = await supabaseAdmin
      .from('tenant_members')
      .select('tenant_id, role')
      .eq('user_id', userId)
      .limit(1)
      .single();

    const tenantId = membership?.tenant_id as string | undefined;
    if (!tenantId) {
      return { success: false, error: 'Nessun tenant associato all\'utente. Contatta il supporto.' };
    }
    // Difesa in profondità: nella UI un agente non vede nemmeno la vista
    // Storico Ordini, ma questa Server Action resta un endpoint POST
    // richiamabile con qualunque payload — un agente autenticato non deve
    // poter approvare/annullare ordini (anche i propri) chiamandola
    // direttamente, altrimenti il flusso di revisione del titolare perde di
    // senso.
    if ((membership as { role?: string } | null)?.role === 'agent') {
      return { success: false, error: 'Il tuo ruolo non è autorizzato a confermare o annullare ordini.' };
    }

    // L'ownership dell'ordine è verificata direttamente nella WHERE
    // dell'UPDATE (tenant_id = tenantId): se l'ordine appartenesse a un altro
    // tenant nessuna riga verrebbe aggiornata, invece di fidarsi di un
    // orderId fornito dal client senza controllo.
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('orders')
      .update({ status })
      .eq('id', orderId)
      .eq('tenant_id', tenantId)
      .select('id')
      .maybeSingle();

    if (updateError) {
      console.error('[updateOrderStatusAction] Errore aggiornamento stato:', updateError);
      return { success: false, error: 'Errore nell\'aggiornamento dello stato dell\'ordine' };
    }
    if (!updated) {
      return { success: false, error: 'Ordine non trovato o non appartenente al tuo account.' };
    }

    return { success: true };
  } catch (err) {
    console.error('[updateOrderStatusAction] Unexpected error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Errore sconosciuto',
    };
  }
}

// ─── URL firmato per il memo audio dell'agente ─────────────────────────────────
// Il bucket 'comandi-agent-audio' è privato (vedi migrazione
// 20260803000000_comandi_agent_role.sql): l'audio non è mai raggiungibile con
// un URL pubblico, va generato un signed URL a breve scadenza on-demand,
// SOLO dopo aver verificato che l'ordine (e quindi l'audio) appartenga
// davvero al tenant dell'utente autenticato.

const AUDIO_BUCKET = 'comandi-agent-audio';
// Validità breve: rigenerato ad ogni click su "Ascolta memo", non serve che
// resti valido a lungo e aumenterebbe solo la finestra di esposizione se il
// link venisse copiato o condiviso per errore.
const AUDIO_SIGNED_URL_TTL_SECONDS = 300;

const GetOrderAudioUrlInputSchema = z.object({
  orderId: z.uuid(),
  accessToken: z.string().min(1),
});

export type GetOrderAudioUrlInput = z.infer<typeof GetOrderAudioUrlInputSchema>;

export interface GetOrderAudioUrlResult {
  success: boolean;
  url?: string;
  error?: string;
}

export async function getOrderAudioSignedUrlAction(input: GetOrderAudioUrlInput): Promise<GetOrderAudioUrlResult> {
  try {
    const validation = GetOrderAudioUrlInputSchema.safeParse(input);
    if (!validation.success) {
      return { success: false, error: validation.error.issues[0]?.message || 'Dati non validi' };
    }
    const { orderId, accessToken } = validation.data;

    const supabaseAuth = createClient<Database>(supabaseUrl, supabaseAnonKey);
    const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceKey);

    let userId: string | undefined;
    try {
      const userResult = await supabaseAuth.auth.getUser(accessToken);
      userId = userResult.data.user?.id || undefined;
    } catch (err) {
      console.error('[getOrderAudioSignedUrlAction] Auth error:', err);
    }
    if (!userId) {
      return { success: false, error: 'Devi effettuare il login per ascoltare il memo audio' };
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

    // Legge audio_url SOLO se l'ordine appartiene al tenant dell'utente
    // autenticato: è questo il vero controllo di ownership richiesto, non la
    // RLS del bucket (qui bypassata dal service role) — senza questo filtro
    // un utente di un altro tenant potrebbe farsi generare un signed URL per
    // un ordine (e quindi un audio) che non gli appartiene, semplicemente
    // indovinando o enumerando un orderId.
    const { data: order, error: orderError } = await (supabaseAdmin as any)
      .from('orders')
      .select('audio_url')
      .eq('id', orderId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (orderError) {
      console.error('[getOrderAudioSignedUrlAction] Errore lettura ordine:', orderError);
      return { success: false, error: 'Errore nel recupero dell\'ordine' };
    }
    if (!order) {
      return { success: false, error: 'Ordine non trovato o non appartenente al tuo account.' };
    }
    if (!order.audio_url) {
      return { success: false, error: 'Nessun memo audio disponibile per questo ordine.' };
    }

    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from(AUDIO_BUCKET)
      .createSignedUrl(order.audio_url as string, AUDIO_SIGNED_URL_TTL_SECONDS);

    if (signError || !signed?.signedUrl) {
      console.error('[getOrderAudioSignedUrlAction] Errore generazione signed URL:', signError);
      return { success: false, error: 'Errore nella generazione del link audio.' };
    }

    return { success: true, url: signed.signedUrl };
  } catch (err) {
    console.error('[getOrderAudioSignedUrlAction] Unexpected error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Errore sconosciuto',
    };
  }
}
