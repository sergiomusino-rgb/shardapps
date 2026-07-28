'use server';

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { extractStructuredOrder } from '@/src/lib/comandi-voice-extraction';
import type { VoiceOrderExtraction } from '@/types/comandi';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExtractVoiceOrderInput {
  audioTranscript: string;
  /**
   * Access token della sessione Supabase corrente (supabaseBrowser.auth.getSession()).
   * L'app non usa createBrowserClient di @supabase/ssr, quindi la sessione
   * vive solo in localStorage lato client: le Server Action non possono
   * derivarla dai cookie (sarebbero sempre vuoti) e devono validare questo
   * token esplicitamente con supabase.auth.getUser(accessToken).
   */
  accessToken: string;
}

export interface ExtractVoiceOrderResult {
  success: boolean;
  data?: VoiceOrderExtraction;
  error?: string;
}

// ─── Server Action ────────────────────────────────────────────────────────────
// La logica di estrazione (catalogo, prompt, chiamata LLM, validazione Zod,
// difesa anti-allucinazione) vive in src/lib/comandi-voice-extraction.ts,
// condivisa con app/api/agent-voice-order/route.ts (pipeline Whisper per la
// pagina Agente). Questa Server Action si occupa solo di autenticare la
// richiesta e derivare tenant_id in modo sicuro prima di delegare.
export async function extractVoiceOrderAction(
  input: ExtractVoiceOrderInput
): Promise<ExtractVoiceOrderResult> {
  try {
    const audioTranscript = (input.audioTranscript || '').trim();
    if (!audioTranscript) {
      return { success: false, error: 'Trascrizione audio mancante' };
    }

    if (!input.accessToken) {
      return { success: false, error: 'Devi effettuare il login per creare un ordine' };
    }

    // Client con anon key, usato solo per validare il token passato dal client
    const supabaseAuth = createClient<Database>(supabaseUrl, supabaseAnonKey);

    // Client con service role per le query dati (bypassa RLS lato server)
    const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceKey);

    // Il tenant_id non viene MAI accettato da input: è una Server Action
    // chiamabile come un endpoint POST con payload arbitrario, quindi
    // fidarsi di un tenant_id fornito dal client permetterebbe di leggere il
    // catalogo e generare ordini per il tenant di chiunque altro. L'unica
    // fonte attendibile è l'utente risolto dal token di sessione, verificato
    // qui contro Supabase Auth (non un tenant_id fornito direttamente).
    let userId: string | undefined;
    try {
      const userResult = await supabaseAuth.auth.getUser(input.accessToken);
      userId = userResult.data.user?.id || undefined;
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

    return await extractStructuredOrder(supabaseAdmin, tenantId, audioTranscript);
  } catch (err) {
    console.error('[extractVoiceOrderAction] Unexpected error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Errore sconosciuto',
    };
  }
}
