'use server';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import {
  VoiceOrderExtractionSchema,
  type VoiceOrderExtraction,
  type CatalogItem,
  type ProductSynonym,
} from '@/types/comandi';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Sotto questa soglia di confidenza complessiva, l'ordine va sempre in
// revisione manuale a prescindere da cosa dichiari l'LLM: un operatore non
// deve mai vedere un ordine confermato automaticamente se l'estrazione è
// incerta.
const MIN_AUTO_CONFIRM_CONFIDENCE = 0.75;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExtractVoiceOrderInput {
  audioTranscript: string;
}

export interface ExtractVoiceOrderResult {
  success: boolean;
  data?: VoiceOrderExtraction;
  error?: string;
}

// ─── LLM Call ─────────────────────────────────────────────────────────────────

async function callLLM(prompt: string): Promise<string> {
  const provider = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();

  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY non configurata');

    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(prompt);
    return result.response.text();
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

  throw new Error(`Provider '${provider}' non supportato. Usa 'gemini' o 'openai'.`);
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

// ─── Server Action ────────────────────────────────────────────────────────────

export async function extractVoiceOrderAction(
  input: ExtractVoiceOrderInput
): Promise<ExtractVoiceOrderResult> {
  try {
    const audioTranscript = (input.audioTranscript || '').trim();
    if (!audioTranscript) {
      return { success: false, error: 'Trascrizione audio mancante' };
    }

    const cookieStore = await cookies();
    const cookieAdapter = {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: any) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // Ignora errori in server action read-only
        }
      },
      remove(name: string, options: any) {
        try {
          cookieStore.set({ name, value: '', ...options });
        } catch {
          // Ignora errori
        }
      },
    };

    // Client con anon key per leggere la sessione utente dai cookie
    const supabaseAuth = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: cookieAdapter,
    });

    // Client con service role per le query dati (bypassa RLS lato server)
    const supabaseAdmin = createServerClient(supabaseUrl, supabaseServiceKey, {
      cookies: cookieAdapter,
    });

    // Il tenant_id non viene MAI accettato da input: è una Server Action
    // chiamabile come un endpoint POST con payload arbitrario, quindi
    // fidarsi di un tenant_id fornito dal client permetterebbe di leggere il
    // catalogo e generare ordini per il tenant di chiunque altro. L'unica
    // fonte attendibile è la sessione Supabase legata ai cookie della
    // richiesta (stesso pattern di frontend/app/actions/generator.ts).
    let userId: string | undefined;
    try {
      const userResult = await supabaseAuth.auth.getUser();
      userId = userResult.data.user?.id || undefined;
      if (!userId) {
        const sessionResult = await supabaseAuth.auth.getSession();
        userId = sessionResult.data.session?.user?.id || undefined;
      }
    } catch (err) {
      console.error('[extractVoiceOrderAction] Auth error:', err);
    }

    if (!userId) {
      return { success: false, error: 'Devi effettuare il login per creare un ordine' };
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

    // Recupera catalogo attivo + sinonimi del tenant
    const { data: catalogItems, error: catalogError } = await supabaseAdmin
      .from('catalog_items')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true);

    if (catalogError) {
      console.error('[extractVoiceOrderAction] Errore lettura catalogo:', catalogError);
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
        console.error('[extractVoiceOrderAction] Errore lettura sinonimi:', synonymError);
        return { success: false, error: 'Errore nel recupero dei sinonimi prodotto' };
      }
      synonyms = (synonymRows || []) as ProductSynonym[];
    }

    // Costruisci prompt e chiama l'LLM
    const catalogListing = buildCatalogListing(items, synonyms);
    const prompt = buildExtractionPrompt(audioTranscript, catalogListing);

    let rawResponse: string;
    try {
      rawResponse = await callLLM(prompt);
    } catch (err) {
      console.error('[extractVoiceOrderAction] Errore chiamata LLM:', err);
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
      console.error('[extractVoiceOrderAction] JSON parse error. Raw:', rawResponse);
      return { success: false, error: 'Il modello ha restituito un JSON non valido' };
    }

    // tenant_id è sempre impostato dal server, mai fidandosi dell'LLM
    parsed.tenant_id = tenantId;

    const validation = VoiceOrderExtractionSchema.safeParse(parsed);
    if (!validation.success) {
      console.error('[extractVoiceOrderAction] Validazione Zod fallita:', validation.error.message);
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
  } catch (err) {
    console.error('[extractVoiceOrderAction] Unexpected error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Errore sconosciuto',
    };
  }
}
