import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { callAiRouter, AiRouterError, AiRouterConfigError, type AiRouterMessage } from '@/src/lib/ai-router';

const SYSTEM_PROMPT = `Sei ZeusX AI, un assistente AI specializzato nella piattaforma ZeusX.
Sei preparato, utile, creativo e conciso. Puoi aiutare gli utenti a:
- Capire come funziona ZeusX
- Creare applicazioni SaaS tramite il generatore AI
- Rispondere a domande tecniche e di business
- Fornire consigli su sviluppo e best practices

Rispondi sempre in italiano a meno che non richiesto espressamente in un'altra lingua.`;

// Chiama un provider AI a pagamento con le chiavi del proprietario del sito:
// senza autenticazione chiunque conoscesse l'URL potrebbe consumare budget
// illimitato (nessun rate limiting è configurato su questo endpoint).
async function requireAuth(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data: { user }, error } = await supabase.auth.getUser(token);
  return !error && user ? user.id : null;
}

export async function POST(request: NextRequest) {
  try {
    const userId = await requireAuth(request);
    if (!userId) {
      return NextResponse.json({ error: 'Autenticazione richiesta' }, { status: 401 });
    }

    const body = await request.json();
    const { messages } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({
        error: 'Messaggi richiesti'
      }, { status: 400 });
    }

    // Aggiungi il system prompt se non è già presente
    const allMessages: AiRouterMessage[] = messages[0]?.role === 'system'
      ? messages
      : [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];

    // Chat generico: task "chat" -> tier "fast" dell'AI Router (nessuna
    // generazione complessa di app/codice, non serve il modello avanzato).
    const { content: reply } = await callAiRouter({
      task: 'chat',
      messages: allMessages,
      context: { userId },
    });

    return NextResponse.json({ reply });

  } catch (err) {
    console.error('Chat API error:', err);
    if (err instanceof AiRouterConfigError) {
      return NextResponse.json({ error: 'Servizio AI non configurato correttamente. Contatta il supporto.' }, { status: 500 });
    }
    if (err instanceof AiRouterError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Errore interno del server'
    }, { status: 500 });
  }
}
