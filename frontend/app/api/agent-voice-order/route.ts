// ─── Comandi: Agent Voice Order API Route (Next.js App Router) ────────────────
// Riceve la registrazione audio di un agente sul campo (MediaRecorder,
// app/a/[slug]/app/agente/page.tsx), la trascrive con Whisper (Groq,
// audio.transcriptions.create), la struttura in articoli/quantità con lo
// stesso motore LLM già usato dal widget Web Speech (src/lib/
// comandi-voice-extraction.ts) e salva l'ordine direttamente nella tabella
// `orders` del tenant, in stato PENDING_CONFIRMATION: un ordine raccolto a
// voce da un singolo passaggio server, senza revisione umana precedente, non
// deve mai risultare CONFIRMED — resta in coda per una verifica successiva
// (Storico Ordini nella dashboard del titolare).
//
// Sicurezza: stesso principio delle Server Action Comandi esistenti
// (app/actions/comandi-voice.ts, comandi-orders.ts) — tenant_id e agent_id
// derivano SEMPRE dall'utente risolto dal token Bearer via Supabase Auth, mai
// da un valore fornito dal client. L'accesso è aperto a qualunque membro del
// tenant (owner/admin/agent/member): raccogliere un ordine è un'azione a
// basso rischio concessa a tutti i ruoli, la restrizione del ruolo "agent"
// riguarda le altre sezioni dell'app (catalogo in sola lettura, niente dati
// aziendali/incassi), non questa.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { extractStructuredOrder } from '@/src/lib/comandi-voice-extraction';
import type { Customer } from '@/types/comandi';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const AUDIO_BUCKET = 'comandi-agent-audio';
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25MB, coerente col limite del bucket (migrazione)
const ACCEPTED_AUDIO_TYPES = new Set([
  'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/x-m4a',
]);

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function extensionForMimeType(mimeType: string): string {
  const map: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/mp4': 'mp4',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/x-m4a': 'm4a',
  };
  return map[mimeType] || 'webm';
}

// Formato atteso: YYYY-MM-DD. Non usiamo `new Date(str)` per validare (accetta
// troppi formati ambigui): un semplice controllo di forma è sufficiente dato
// che il valore arriva da un <input type="date"> lato client.
function isValidDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// ─── Client Supabase ────────────────────────────────────────────────────────

function getServiceSupabase() {
  return createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Stesso pattern usato in app/actions/comandi-voice.ts e comandi-orders.ts:
// l'app non usa @supabase/ssr, quindi non esistono cookie di sessione lato
// server. Una rotta REST (a differenza di una Server Action) riceve il token
// nell'header Authorization invece che come campo del payload.
async function getUserIdFromBearerToken(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  const supabaseAuth = createClient<Database>(supabaseUrl, supabaseAnonKey);
  try {
    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
  } catch (err) {
    console.error('[agent-voice-order] Auth error:', err);
    return null;
  }
}

// ─── POST /api/agent-voice-order ────────────────────────────────────────────
export async function POST(request: NextRequest) {
  if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
    console.error('[agent-voice-order] Supabase non configurato correttamente.');
    return NextResponse.json(
      { success: false, error: 'Servizio non configurato correttamente. Contatta il supporto.', code: 'CONFIG_ERROR' },
      { status: 500 }
    );
  }
  if (!process.env.GROQ_API_KEY) {
    console.error('[agent-voice-order] GROQ_API_KEY non configurata.');
    return NextResponse.json(
      { success: false, error: 'Servizio di trascrizione non configurato. Contatta il supporto.', code: 'CONFIG_ERROR' },
      { status: 500 }
    );
  }

  // ── Auth ──────────────────────────────────────────────────────────────
  const userId = await getUserIdFromBearerToken(request);
  if (!userId) {
    return NextResponse.json(
      { success: false, error: 'Autenticazione richiesta.', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }

  const supabaseAdmin = getServiceSupabase();

  // tenant_id deriva ESCLUSIVAMENTE dalla membership dell'utente autenticato,
  // mai da un valore inviato dal client (stesso principio delle Server Action
  // Comandi esistenti): altrimenti un utente potrebbe far salvare ordini nel
  // tenant di qualcun altro passando un tenant_id/slug a piacere.
  const { data: membership } = await supabaseAdmin
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', userId)
    .limit(1)
    .single();

  const tenantId = membership?.tenant_id as string | undefined;
  if (!tenantId) {
    return NextResponse.json(
      { success: false, error: 'Nessun tenant associato all\'utente. Contatta il supporto.', code: 'NO_TENANT' },
      { status: 403 }
    );
  }

  // ── Parsing input (multipart: audio + metadati) ─────────────────────────
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    console.error('[agent-voice-order] Errore parsing FormData:', err);
    return NextResponse.json(
      { success: false, error: 'Richiesta non valida: atteso multipart/form-data con il campo "audio".', code: 'INVALID_INPUT' },
      { status: 400 }
    );
  }

  const audioEntry = formData.get('audio');
  if (!(audioEntry instanceof File) || audioEntry.size === 0) {
    return NextResponse.json(
      { success: false, error: 'File audio mancante.', code: 'INVALID_INPUT' },
      { status: 400 }
    );
  }
  if (audioEntry.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { success: false, error: 'File audio troppo grande (max 25MB).', code: 'INVALID_INPUT' },
      { status: 400 }
    );
  }
  const audioMimeType = ACCEPTED_AUDIO_TYPES.has(audioEntry.type) ? audioEntry.type : 'audio/webm';

  const customerNameRaw = formData.get('customerName');
  const customerName = typeof customerNameRaw === 'string' && customerNameRaw.trim() ? customerNameRaw.trim() : null;

  const customerIdRaw = formData.get('customerId');
  const requestedCustomerId = typeof customerIdRaw === 'string' && customerIdRaw.trim() ? customerIdRaw.trim() : null;

  const deliveryDateRaw = formData.get('deliveryDate');
  const deliveryDate =
    typeof deliveryDateRaw === 'string' && isValidDateString(deliveryDateRaw) ? deliveryDateRaw : null;

  const notesRaw = formData.get('notes');
  const notes = typeof notesRaw === 'string' && notesRaw.trim() ? notesRaw.trim() : null;

  // Se è stato indicato un cliente dalla rubrica, verifica che appartenga
  // davvero al tenant dell'agente (non fidarsi dell'id passato dal client) e
  // usalo per completare nome/telefono sull'ordine.
  let resolvedCustomer: Customer | null = null;
  if (requestedCustomerId) {
    const { data: customerRow } = await (supabaseAdmin as any)
      .from('customers')
      .select('*')
      .eq('id', requestedCustomerId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    resolvedCustomer = (customerRow as Customer | null) ?? null;
  }

  // ── 1. Trascrizione audio (Whisper via Groq) ─────────────────────────────
  let transcript: string;
  try {
    const { default: Groq } = await import('groq-sdk');
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const transcription = await groq.audio.transcriptions.create({
      file: audioEntry,
      model: 'whisper-large-v3-turbo',
      language: 'it',
    });
    transcript = (transcription.text || '').trim();
  } catch (err) {
    console.error('[agent-voice-order] Errore trascrizione Whisper:', err);
    return NextResponse.json(
      { success: false, error: 'Trascrizione audio non riuscita. Riprova.', code: 'TRANSCRIPTION_ERROR' },
      { status: 502 }
    );
  }

  if (!transcript) {
    return NextResponse.json(
      { success: false, error: 'Nessun parlato riconosciuto nella registrazione. Riprova avvicinando il microfono.', code: 'EMPTY_TRANSCRIPT' },
      { status: 400 }
    );
  }

  // ── 2. Estrazione strutturata (stesso motore del widget Web Speech) ─────
  const extraction = await extractStructuredOrder(supabaseAdmin, tenantId, transcript);
  if (!extraction.success || !extraction.data) {
    return NextResponse.json(
      { success: false, error: extraction.error || 'Elaborazione AI dell\'ordine non riuscita.', code: 'EXTRACTION_ERROR' },
      { status: 502 }
    );
  }
  const finalExtraction = extraction.data;

  // ── 3. Upload audio originale (best-effort: non blocca il salvataggio) ──
  // Il bucket è privato (vedi migrazione 20260803000000): audio_url è il
  // path dell'oggetto, non un URL pubblico. Se l'upload fallisce, l'ordine
  // viene comunque salvato senza allegato audio invece di far perdere
  // all'agente un ordine già trascritto/strutturato correttamente.
  let audioPath: string | null = null;
  try {
    const objectPath = `${tenantId}/${crypto.randomUUID()}.${extensionForMimeType(audioMimeType)}`;
    const audioBytes = Buffer.from(await audioEntry.arrayBuffer());
    const { error: uploadError } = await supabaseAdmin.storage
      .from(AUDIO_BUCKET)
      .upload(objectPath, audioBytes, { contentType: audioMimeType, upsert: false });
    if (uploadError) throw uploadError;
    audioPath = objectPath;
  } catch (err) {
    console.error('[agent-voice-order] Upload audio fallito (non bloccante):', err);
  }

  // ── 4. Salvataggio ordine + righe ────────────────────────────────────────
  const totalAmount = round2(
    finalExtraction.parsed_items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0)
  );

  const { data: newOrder, error: orderError } = await (supabaseAdmin as any)
    .from('orders')
    .insert({
      tenant_id: tenantId,
      customer_id: resolvedCustomer?.id ?? null,
      customer_name: resolvedCustomer?.name ?? customerName,
      customer_phone: resolvedCustomer?.phone ?? null,
      agent_id: userId,
      status: 'PENDING_CONFIRMATION',
      total_amount: totalAmount,
      audio_transcript: transcript,
      confidence_score: finalExtraction.confidence_score,
      delivery_date: deliveryDate,
      extracted_items: {
        summary_text: finalExtraction.summary_text,
        parsed_items: finalExtraction.parsed_items,
        discarded_items: finalExtraction.discarded_items,
      },
      audio_url: audioPath,
      notes,
    })
    .select('id')
    .single();

  if (orderError || !newOrder) {
    console.error('[agent-voice-order] Errore creazione ordine:', orderError);
    return NextResponse.json(
      { success: false, error: 'Errore nel salvataggio dell\'ordine.', code: 'SAVE_ERROR' },
      { status: 500 }
    );
  }

  if (finalExtraction.parsed_items.length > 0) {
    const orderItemsPayload = finalExtraction.parsed_items.map((item) => ({
      tenant_id: tenantId,
      order_id: newOrder.id,
      product_id: item.product_id,
      product_name: item.matched_name,
      unit_price: round2(item.unit_price),
      quantity: item.quantity,
      unit: item.unit,
      subtotal: round2(item.unit_price * item.quantity),
    }));

    const { error: itemsError } = await supabaseAdmin.from('order_items').insert(orderItemsPayload);
    if (itemsError) {
      console.error('[agent-voice-order] Errore creazione righe ordine, rollback:', itemsError);
      // Rollback: elimina l'ordine appena creato per non lasciare un ordine senza righe.
      await supabaseAdmin.from('orders').delete().eq('id', newOrder.id);
      return NextResponse.json(
        { success: false, error: 'Errore nel salvataggio delle righe ordine.', code: 'SAVE_ERROR' },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      orderId: newOrder.id as string,
      status: 'PENDING_CONFIRMATION',
      transcript,
      summary: finalExtraction.summary_text,
      confidenceScore: finalExtraction.confidence_score,
      requiresManualConfirmation: finalExtraction.requires_manual_confirmation,
      items: finalExtraction.parsed_items,
      discardedItems: finalExtraction.discarded_items,
      totalAmount,
      customerName: resolvedCustomer?.name ?? customerName,
      deliveryDate,
    },
  });
}
