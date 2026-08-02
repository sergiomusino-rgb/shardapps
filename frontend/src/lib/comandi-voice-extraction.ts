// ─── Motore "Comandi": estrazione strutturata di un ordine da trascrizione ──
// Core condiviso da app/actions/comandi-voice.ts (Server Action, usata dal
// widget Web Speech VoiceInputWidget) e app/api/agent-voice-order/
// route.ts (rotta REST, usata dalla pagina Agente con registrazione audio +
// trascrizione Whisper). Estratto qui perché un file 'use server' può solo
// esportare funzioni async chiamabili come Server Action: la logica di
// prompt/LLM/validazione non potrebbe essere importata da una route.ts se
// restasse dentro comandi-voice.ts. Nessuna duplicazione: entrambi i
// chiamanti derivano tenant_id dalla sessione autenticata (mai da input
// client) PRIMA di arrivare qui, e passano solo tenant_id + trascrizione già
// fidati.

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import {
  VoiceOrderExtractionSchema,
  type VoiceOrderExtraction,
  type CatalogItem,
  type ProductSynonym,
} from '@/types/comandi';

type SupabaseAdmin = ReturnType<typeof createClient<Database>>;

// Sotto questa soglia di confidenza complessiva, l'ordine va sempre in
// revisione manuale a prescindere da cosa dichiari l'LLM: un operatore non
// deve mai vedere un ordine confermato automaticamente se l'estrazione è
// incerta.
const MIN_AUTO_CONFIRM_CONFIDENCE = 0.75;

export interface ExtractStructuredOrderResult {
  success: boolean;
  data?: VoiceOrderExtraction;
  error?: string;
}

// ─── LLM Call ─────────────────────────────────────────────────────────────────

export async function callLLM(prompt: string): Promise<string> {
  const provider = (process.env.LLM_PROVIDER || 'groq').toLowerCase();

  if (provider === 'groq') {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY non configurata');

    const { default: Groq } = await import('groq-sdk');
    const groq = new Groq({ apiKey });
    const completion = await groq.chat.completions.create({
      // llama-3.3-70b-versatile: miglior compromesso qualità/latenza per
      // l'estrazione strutturata dell'ordine dal catalogo. In alternativa
      // llama3-8b-8192 per la massima velocità a scapito della precisione
      // nel matching dei prodotti.
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    return completion.choices[0]?.message?.content || '';
  }

  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY non configurata');

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Errore OpenAI');
    return data.choices?.[0]?.message?.content || '';
  }

  throw new Error(`Provider '${provider}' non supportato. Usa 'groq' o 'openai'.`);
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildCatalogListing(items: CatalogItem[], synonyms: ProductSynonym[]): string {
  const synonymsByProduct = new Map<string, string[]>();
  for (const syn of synonyms) {
    const list = synonymsByProduct.get(syn.product_id) || [];
    list.push(syn.spoken_alias);
    synonymsByProduct.set(syn.product_id, list);
  }

  return items
    .map((item) => {
      const aliases = synonymsByProduct.get(item.id);
      const aliasesPart = aliases && aliases.length > 0 ? `, sinonimi: ${aliases.join(', ')}` : '';
      return `- id=${item.id}, sku=${item.sku}, nome="${item.name}", prezzo=${item.unit_price}, unità=${item.unit_of_measure}${aliasesPart}`;
    })
    .join('\n');
}

function buildExtractionPrompt(audioTranscript: string, catalogListing: string): string {
  return `Sei un sistema di estrazione ordini per un motore di ordini vocali. Devi produrre SOLO un oggetto JSON valido, senza testo aggiuntivo, senza markdown, senza spiegazioni.

Trascrizione audio del cliente:
"""
${audioTranscript}
"""

Catalogo prodotti disponibile (usa SOLO questi prodotti per il campo product_id/sku, non inventarne altri):
${catalogListing || '(nessun prodotto attivo nel catalogo)'}

Analizza la trascrizione e produci un JSON con questo schema esatto:
{
  "confidence_score": numero tra 0 e 1 che rappresenta la confidenza complessiva sull'intero ordine,
  "requires_manual_confirmation": true|false,
  "summary_text": "riepilogo breve e leggibile dell'ordine in italiano",
  "parsed_items": [
    {
      "product_id": "id del prodotto dal catalogo sopra, o null se non trovato",
      "sku": "sku del prodotto dal catalogo sopra, o null se non trovato",
      "matched_name": "nome del prodotto agganciato dal catalogo, o il nome inteso se non trovato",
      "original_spoken_text": "frammento originale della trascrizione da cui è stata estratta la riga",
      "quantity": numero positivo,
      "unit": "unità di misura (es. pz, kg, lt)",
      "unit_price": prezzo unitario dal catalogo (0 se prodotto non trovato),
      "confidence": numero tra 0 e 1 per questa singola riga
    }
  ],
  "discarded_items": [
    {
      "original_spoken_text": "frammento della trascrizione scartato o non riconosciuto",
      "reason": "motivo dello scarto (es. prodotto non trovato, frase annullata dal cliente, ambiguo)"
    }
  ]
}

Regole:
- Se il cliente annulla o corregge una richiesta precedente nella stessa trascrizione, non includerla in parsed_items ma in discarded_items con reason appropriato.
- Se non riesci ad agganciare un prodotto del catalogo con ragionevole certezza, metti la frase in discarded_items invece di inventare un product_id.
- Non includere il campo tenant_id: verrà impostato dal sistema.
- Output SOLO JSON, niente markdown, niente spiegazioni.`;
}

// ─── Estrazione strutturata ─────────────────────────────────────────────────
// tenant_id deve già essere stato derivato dal chiamante dalla sessione
// autenticata (mai da input client): questa funzione si fida del tenantId
// ricevuto e lo usa per leggere il catalogo con cui riconciliare la
// trascrizione.
export async function extractStructuredOrder(
  supabaseAdmin: SupabaseAdmin,
  tenantId: string,
  audioTranscript: string
): Promise<ExtractStructuredOrderResult> {
  const transcript = (audioTranscript || '').trim();
  if (!transcript) {
    return { success: false, error: 'Trascrizione audio mancante' };
  }

  // Recupera catalogo attivo + sinonimi del tenant
  const { data: catalogItems, error: catalogError } = await supabaseAdmin
    .from('catalog_items')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true);

  if (catalogError) {
    console.error('[extractStructuredOrder] Errore lettura catalogo:', catalogError);
    return { success: false, error: 'Errore nel recupero del catalogo prodotti' };
  }

  const items = (catalogItems || []) as CatalogItem[];
  const catalogIds = items.map((item) => item.id);

  let synonyms: ProductSynonym[] = [];
  if (catalogIds.length > 0) {
    const { data: synonymRows, error: synonymError } = await supabaseAdmin
      .from('product_synonyms')
      .select('*')
      .eq('tenant_id', tenantId)
      .in('product_id', catalogIds);

    if (synonymError) {
      console.error('[extractStructuredOrder] Errore lettura sinonimi:', synonymError);
      return { success: false, error: 'Errore nel recupero dei sinonimi prodotto' };
    }
    synonyms = (synonymRows || []) as ProductSynonym[];
  }

  // Costruisci prompt e chiama l'LLM
  const catalogListing = buildCatalogListing(items, synonyms);
  const prompt = buildExtractionPrompt(transcript, catalogListing);

  let rawResponse: string;
  try {
    rawResponse = await callLLM(prompt);
  } catch (err) {
    console.error('[extractStructuredOrder] Errore chiamata LLM:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Errore nella chiamata al modello AI' };
  }

  const cleaned = rawResponse
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error('[extractStructuredOrder] JSON parse error. Raw:', rawResponse);
    return { success: false, error: 'Il modello ha restituito un JSON non valido' };
  }

  // tenant_id è sempre impostato dal server, mai fidandosi dell'LLM
  parsed.tenant_id = tenantId;

  const validation = VoiceOrderExtractionSchema.safeParse(parsed);
  if (!validation.success) {
    console.error('[extractStructuredOrder] Validazione Zod fallita:', validation.error.message);
    return { success: false, error: 'Il modello ha restituito un formato ordine non valido' };
  }

  const extraction = validation.data;

  // Difesa contro allucinazioni: scarta ogni riga il cui product_id non
  // esiste realmente nel catalogo appena letto dal database, invece di
  // fidarsi ciecamente del match dichiarato dall'LLM.
  const catalogById = new Map(items.map((item) => [item.id, item]));
  const parsedItems = [];
  const discardedItems = [...extraction.discarded_items];
  let hadInvalidMatch = false;

  for (const parsedItem of extraction.parsed_items) {
    if (parsedItem.product_id && !catalogById.has(parsedItem.product_id)) {
      hadInvalidMatch = true;
      discardedItems.push({
        original_spoken_text: parsedItem.original_spoken_text,
        reason: 'Prodotto indicato dal modello non presente nel catalogo del tenant',
      });
      continue;
    }

    // Prodotto riconosciuto ma esaurito: non deve finire in un ordine che
    // il magazzino non può evadere. Segnalato all'agente come riga scartata
    // (stesso meccanismo di "prodotto non trovato") invece di lasciarlo
    // passare silenziosamente con la quantità richiesta dal cliente.
    const matchedCatalogItem = parsedItem.product_id ? catalogById.get(parsedItem.product_id) : undefined;
    if (matchedCatalogItem && matchedCatalogItem.stock_qty <= 0) {
      hadInvalidMatch = true;
      discardedItems.push({
        original_spoken_text: parsedItem.original_spoken_text,
        reason: `Prodotto non disponibile: "${matchedCatalogItem.name}" risulta esaurito a magazzino`,
      });
      continue;
    }

    parsedItems.push(parsedItem);
  }

  const requiresManualConfirmation =
    extraction.requires_manual_confirmation ||
    extraction.confidence_score < MIN_AUTO_CONFIRM_CONFIDENCE ||
    hadInvalidMatch ||
    discardedItems.length > 0;

  const finalExtraction: VoiceOrderExtraction = {
    ...extraction,
    parsed_items: parsedItems,
    discarded_items: discardedItems,
    requires_manual_confirmation: requiresManualConfirmation,
  };

  return { success: true, data: finalExtraction };
}
