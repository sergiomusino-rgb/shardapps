import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { callAiRouter, AiRouterError, AiRouterConfigError, AiBudgetExceededError, type AiRouterMessage } from '@/src/lib/ai-router';
import { checkRateLimit } from '@/src/lib/rate-limit';

const SYSTEM_PROMPT = `Sei ShardApps AI, un assistente AI specializzato nella piattaforma ShardApps.
Sei preparato, utile, creativo e conciso. Puoi aiutare gli utenti a:
- Capire come funziona ShardApps
- Creare applicazioni SaaS tramite il generatore AI
- Rispondere a domande tecniche e di business
- Fornire consigli su sviluppo e best practices

Rispondi sempre in italiano a meno che non richiesto espressamente in un'altra lingua.`;

// Pre-Beta Hardening, Blocco 1: senza un tenantId nel context, callAiRouter
// non ha alcun budget da applicare a questa chiamata (vedi ai-usage.ts) — la
// chat non aveva mai risolto un tenant, a differenza di creator/generate e
// refactor. Risoluzione best-effort con service role (stesso principio di
// app/actions/generator.ts): la prima membership del chiamante, sufficiente
// per attribuire il consumo, non per un controllo di autorizzazione (questo
// endpoint non legge/scrive nulla del tenant, solo attribuisce un costo).
async function resolveTenantIdForUser(userId: string): Promise<string | null> {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;
  try {
    const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey);
    const { data } = await admin.from('tenant_members').select('tenant_id').eq('user_id', userId).limit(1).maybeSingle();
    return (data as { tenant_id?: string } | null)?.tenant_id || null;
  } catch {
    return null;
  }
}

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

    // 15 richieste/minuto per utente: l'unica regola disponibile sul piano
    // Vercel Firewall è già assegnata a /api/creator/generate (vedi audit
    // pre-lancio), quindi questa route si limita a livello applicativo.
    const { allowed } = await checkRateLimit(`chat:${userId}`, 60, 15);
    if (!allowed) {
      return NextResponse.json({ error: 'Troppe richieste, riprova tra poco.' }, { status: 429 });
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Body della richiesta non è JSON valido' }, { status: 400 });
    }
    const { messages } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({
        error: 'Messaggi richiesti'
      }, { status: 400 });
    }

    // Il system prompt è sempre quello del server: un client che invia il
    // proprio messaggio con role:'system' non deve poter sostituire la
    // persona/istruzioni dell'assistente (jailbreak) né consumare il budget
    // AI della piattaforma per usi non previsti.
    const allMessages: AiRouterMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages.filter((m: AiRouterMessage) => m?.role !== 'system'),
    ];

    const tenantId = await resolveTenantIdForUser(userId);

    // Chat generico: task "chat" -> tier "fast" dell'AI Router (nessuna
    // generazione complessa di app/codice, non serve il modello avanzato).
    const { content: reply } = await callAiRouter({
      task: 'chat',
      messages: allMessages,
      context: { userId, tenantId: tenantId || undefined },
    });

    return NextResponse.json({ reply });

  } catch (err) {
    console.error('Chat API error:', err);
    if (err instanceof AiRouterConfigError) {
      return NextResponse.json({ error: 'Servizio AI non configurato correttamente. Contatta il supporto.' }, { status: 500 });
    }
    if (err instanceof AiBudgetExceededError) {
      return NextResponse.json({ error: err.message, code: 'AI_BUDGET_EXCEEDED' }, { status: 429 });
    }
    if (err instanceof AiRouterError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Errore interno del server'
    }, { status: 500 });
  }
}
