// ─── Creator AI Generate API Route (Next.js App Router) ───────────────────────────────
// Genera lo schema JSON di anteprima tramite OpenRouter (Claude Sonnet 5), CON
// INIEZIONE DEL DESIGN SYSTEM. Non salva nulla: la persistenza avviene solo
// dopo conferma dell'utente su /api/creator/create (vedi DynamicAppPreview).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { getDesignSystemForSector } from '@/lib/designSystemLoader';
import { sanitizeBlueprint, normalizeSector } from '@/src/lib/blueprint-schema';
import { callAiRouter, extractJsonFromAiContent, AiRouterError, AiRouterConfigError } from '@/src/lib/ai-router';
import {
  getUserFromToken,
  getOrCreateTenant,
  canCreateApp,
  CREATOR_ADMIN_USER_ID,
} from '@/src/lib/creator-server';

// Configurazione Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

// ─── Helper: genera lo schema tramite l'AI Router (tier "advanced": generazione
// completa di una nuova app, es. Claude Sonnet 5 via OpenRouter) ────────────────
async function callSchemaGenerator(
  prompt: string,
  sector: string,
  lang: string,
  context: { userId: string; tenantId: string }
): Promise<any> {
  // Carica il design system per il settore
  const designSystem = await getDesignSystemForSector(sector);

  const systemPrompt = `Sei ZeusX AI, un assistente specializzato nella generazione di applicazioni SaaS.
Genera uno schema JSON per un'applicazione di ${sector} in lingua ${lang}.

${designSystem.systemPrompt}

Rispondi SOLO con un JSON valido con la seguente struttura:
{
  "appName": "Nome dell'app",
  "description": "Descrizione breve",
  "sector": "${sector}",
  "ui": {
    "primaryColor": "${designSystem.designTokens?.colors?.primary || '#6366f1'}"
  },
  "schema": {
    "tables": [
      {
        "name": "nome_tabella",
        "label": "Etichetta singolare (es. Pizza, Ordine, Prenotazione)",
        "labelPlural": "Etichetta plurale REALE (es. Pizze, Ordini, Prenotazioni) - MAI la parola generica 'Tabelle'",
        "icon": "📄",
        "fields": [
          {"name": "id", "type": "id", "label": "ID"},
          {"name": "nome_campo", "type": "string", "label": "Etichetta Campo"}
        ]
      }
    ]
  }
}

Crea tabelle e campi SPECIFICI per il settore richiesto. Non usare nomi generici come "nome_tabella" o "nome_campo".
"labelPlural" è OBBLIGATORIO per ogni tabella e deve essere il plurale reale e specifico dell'entità (es. "Ordini", "Prenotazioni", "Menu Pizze", "Clienti") — non usare mai letteralmente la parola "Tabelle" o "Tabella".
Se una tabella rappresenta ordini/prenotazioni/richieste, includi sempre un campo "stato"/"status" di tipo "select" con opzioni di stato realistiche per il settore (es. "In preparazione", "Pronto", "Consegnato" per un ordine di cibo).
Se una tabella rappresenta prodotti/piatti/servizi in vendita, includi sempre un campo prezzo di tipo "number" con nome contenente "prezzo" o "totale".
Non aggiungere testo prima o dopo il JSON.`;

  // "app-generation" -> tier "advanced" (Claude Sonnet 5 via OpenRouter di
  // default): è il caso d'uso di generazione complessa per cui esiste il tier
  // avanzato del router (nuova app completa da prompt).
  const { content } = await callAiRouter({
    task: 'app-generation',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    context: { userId: context.userId, tenantId: context.tenantId },
  });
  console.log('[creator/generate] RAW RESPONSE:', content);

  try {
    const parsed = extractJsonFromAiContent(content) as any;
    // Assicura che ui esista
    if (!parsed.ui) {
      parsed.ui = {
        primaryColor: designSystem.designTokens?.colors?.primary || '#6366f1',
      };
    }
    return parsed;
  } catch (parseError) {
    console.error('[creator/generate] JSON parse error:', parseError, content);
    throw parseError;
  }
}

// ─── POST /api/creator/generate ───────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userPrompt, sector, lang = 'it' } = body;
    const safeSector = sector || 'saas';

    // Validazione input
    if (!userPrompt && !sector) {
      return NextResponse.json({
        success: false,
        error: 'userPrompt o sector è richiesto',
        code: 'MISSING_INPUT'
      }, { status: 400 });
    }

    // Verifica autenticazione
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({
        success: false,
        error: 'Autenticazione richiesta',
        code: 'UNAUTHORIZED'
      }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const user = await getUserFromToken(supabase, token);

    if (!user) {
      return NextResponse.json({
        success: false,
        error: 'Utente non autenticato',
        code: 'UNAUTHORIZED'
      }, { status: 401 });
    }

    // Verifica slot PRIMA di chiamare l'AI, per non sprecare budget se il
    // tenant ha già esaurito le app disponibili sul suo piano — anche in
    // anteprima non ha senso far generare uno schema che non si potrà salvare.
    const tenantId = await getOrCreateTenant(supabase, user, token);
    const { allowed, reason } = await canCreateApp(supabase, tenantId, user.id);

    if (!allowed) {
      if (reason === 'SlotsExhausted') {
        return NextResponse.json({
          success: false,
          error: 'SlotsExhausted',
          message: 'Hai esaurito gli slot app. Acquista un nuovo piano per crearne altre.',
          redirectTo: '/pricing',
          code: 'SLOTS_EXHAUSTED',
        }, { status: 403 });
      }
      return NextResponse.json({
        success: false,
        error: reason || 'Errore controllo limite app',
        code: 'SLOTS_CHECK_ERROR',
      }, { status: 500 });
    }

    // Genera schema tramite l'AI Router (tier "advanced", con design system iniettato)
    const rawSchema = await callSchemaGenerator(
      userPrompt || `Genera un'app per ${safeSector}`,
      safeSector,
      lang,
      { userId: user.id, tenantId }
    );

    // Il settore scelto dall'utente è la fonte di verità (non quello, spesso
    // impreciso o assente, restituito dal modello) — determina layout e colori a runtime.
    rawSchema.sector = normalizeSector(safeSector);

    // FieldSchema (blueprint-schema.ts) valida solo `field.id`, ma il modello a
    // volte genera campi con `name` (formato storico atteso dal viewer). Senza
    // questo step, ogni campo privo di `id` collasserebbe sul default 'campo' di
    // Zod, producendo id duplicati tra i campi di una stessa tabella.
    if (Array.isArray(rawSchema?.schema?.tables)) {
      for (const t of rawSchema.schema.tables) {
        if (!t || typeof t !== 'object') continue;

        // Se il modello non fornisce labelPlural, TableSchema (blueprint-schema.ts)
        // lo forza sul default letterale 'Tabelle' — la stessa entità reale
        // (es. "Pizza") finirebbe con l'etichetta plurale generica invece di
        // qualcosa come "Pizze". Deriviamo un fallback dal label reale.
        if (!t.labelPlural && t.label) {
          const label = String(t.label).trim();
          // Pluralizzazione italiana approssimata (fallback: il modello dovrebbe
          // già fornire labelPlural esplicito, vedi prompt sopra).
          if (/a$/i.test(label)) t.labelPlural = `${label.slice(0, -1)}e`;
          else if (/[oe]$/i.test(label)) t.labelPlural = `${label.slice(0, -1)}i`;
          else t.labelPlural = label;
        }

        if (!Array.isArray(t?.fields)) continue;
        t.fields.forEach((f: any, index: number) => {
          if (!f || typeof f !== 'object' || f.id) return;
          const slug = String(f.label || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
          f.id = f.name || f.key || (slug ? slug : `campo_${index + 1}`);
        });
      }
    }

    // Valida/normalizza l'output del modello prima di restituirlo in anteprima:
    // rifiuta schemi malformati invece di mostrarli così come sono.
    const blueprint = sanitizeBlueprint(rawSchema);
    if (!blueprint) {
      return NextResponse.json({
        success: false,
        error: 'Lo schema generato non è valido, riprova con un prompt più specifico',
        code: 'INVALID_SCHEMA'
      }, { status: 500 });
    }

    // Nessun accesso al DB qui: l'anteprima è "gratuita" da rigenerare finché
    // l'utente non conferma esplicitamente su /api/creator/create.
    return NextResponse.json({
      success: true,
      data: {
        schema: blueprint,
      }
    });

  } catch (err) {
    console.error('[creator/generate] error:', err);
    if (err instanceof AiRouterConfigError) {
      return NextResponse.json({
        success: false,
        error: 'Servizio AI non configurato correttamente. Contatta il supporto.',
        code: 'AI_CONFIG_ERROR'
      }, { status: 500 });
    }
    if (err instanceof AiRouterError) {
      return NextResponse.json({
        success: false,
        error: err.message,
        code: 'AI_PROVIDER_ERROR'
      }, { status: 502 });
    }
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Errore interno del server',
      code: 'INTERNAL_ERROR'
    }, { status: 500 });
  }
}
