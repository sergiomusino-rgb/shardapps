// ─── Creator AI Refactor API Route (Next.js App Router) ────────────────────────────
// Modifica in tempo reale lo schema di un progetto Sito/PWA (site-schema.ts)
// via chat: riceve lo schema corrente + un messaggio in linguaggio naturale,
// restituisce lo schema aggiornato. Strategia "JSON completo modificato"
// (non un vero RFC6902 patch): più affidabile per un LLM che restituire un
// diff, a patto di validare sempre l'output e proteggersi dalla perdita di
// campi non toccati (vedi restoreDanglingEntities sotto).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { callAiRouter, extractJsonFromAiContent, AiRouterError, AiRouterConfigError } from '@/src/lib/ai-router';
import { getUserFromToken } from '@/src/lib/creator-server';
import { checkRateLimit, getClientIp } from '@/src/lib/rate-limit';
import {
  sanitizeSiteBlueprint,
  type SiteBlueprintJSON,
  type AdminEntity,
} from '@/src/lib/site-schema';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

const REFACTOR_SYSTEM_PROMPT = `Sei ShardApps Copilot, l'assistente che modifica dal vivo lo schema JSON di un sito/PWA generato da ShardApps.

Riceverai lo SCHEMA JSON ATTUALE completo e un MESSAGGIO dell'utente che descrive una modifica.

Regole tassative:
1. Applica ESCLUSIVAMENTE la modifica richiesta. Non toccare nessun altro campo, pagina, sezione o entità che non sia necessario cambiare.
2. Rispondi SOLO con lo schema JSON COMPLETO aggiornato, con la stessa identica struttura di quello ricevuto (stessi campi di primo livello: projectType, appName, sector, description, businessConfig, adminPanel, pages, actionButtons, ui, authConfig). Nessun testo prima o dopo, nessun blocco markdown. Se authConfig era presente/abilitato nello schema ricevuto e la modifica non lo riguarda, riportalo INVARIATO — ometterlo lo disabiliterebbe silenziosamente.
3. Se la modifica riguarda un colore, aggiorna ui.primaryColor (formato esadecimale "#rrggbb").
4. Se la modifica aggiunge una sezione a una pagina, usa uno di questi "type" (nessun altro ammesso): hero, about, gallery, list, form, contact, reviews, cta, text.
5. Se la modifica aggiunge/rimuove un'entità del pannello admin, aggiorna di conseguenza anche i riferimenti "entity" nelle sezioni "list"/"form" delle pagine — non lasciare riferimenti a entità inesistenti.
6. Se l'utente chiede di collegare un'entità a un'altra (es. "aggiungi il cliente all'ordine", "collega ogni prenotazione a un tavolo"), aggiungi al campo un "type":"relation" con "targetEntity" impostato al "name" esatto dell'altra entità (deve già esistere in adminPanel.entities, o essere creata nella stessa modifica) e "displayField" impostato all'"id" di un suo campo leggibile (es. "ragione_sociale", "nome" — mai "id"). Se la modifica rinomina o rimuove un'entità che è target di un campo "relation" di un'altra entità, aggiorna anche quel "targetEntity" di conseguenza — non lasciarlo puntare a un nome che non esiste più.
7. Se l'utente chiede un flusso di lavoro su un'entità (es. "l'ordine deve poter passare da nuovo a in preparazione a consegnato", "aggiungi uno stato annullato agli interventi"), usa su un campo dell'entità "type":"state" con "states" (vocabolario completo) e "allowedTransitions" (mappa stato->stati raggiungibili), e aggiungi ad "actions" dell'entità le azioni "change_state" corrispondenti (targetState deve essere uno degli "states"). Se l'utente chiede ruoli/utenti diversi (es. "voglio un ruolo admin e uno operatore", "i dipendenti non devono poter cancellare nulla"), imposta/aggiorna authConfig.enabled=true, authConfig.supportedRoles e authConfig.defaultRole, ed eventualmente requiredRole sulle azioni che devono restare riservate.
8. Se il messaggio dell'utente è ambiguo o non applicabile allo schema, restituisci lo schema invariato.`;

function collectReferencedEntities(schema: SiteBlueprintJSON): Set<string> {
  const names = new Set<string>();
  for (const page of schema.pages) {
    for (const section of page.sections) {
      if ((section.type === 'list' || section.type === 'form') && section.entity) {
        names.add(section.entity);
      }
    }
  }
  return names;
}

// Se il modello, applicando una modifica non correlata, ha perso per strada
// un'entità del pannello admin ancora referenziata da una pagina, la
// ripristina da quella precedente invece di lasciare un riferimento a vuoto
// (una "list"/"form" senza la propria entità renderizza uno stato vuoto).
function restoreDanglingEntities(next: SiteBlueprintJSON, previous: SiteBlueprintJSON): SiteBlueprintJSON {
  const referenced = collectReferencedEntities(next);
  const presentNames = new Set(next.adminPanel.entities.map((e) => e.name));
  const missing = [...referenced].filter((name) => !presentNames.has(name));
  if (missing.length === 0) return next;

  const previousByName = new Map<string, AdminEntity>(previous.adminPanel.entities.map((e) => [e.name, e]));
  const restored = missing.map((name) => previousByName.get(name)).filter((e): e is AdminEntity => !!e);
  if (restored.length === 0) return next;

  return {
    ...next,
    adminPanel: { entities: [...next.adminPanel.entities, ...restored] },
  };
}

export async function POST(request: NextRequest) {
  try {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Body della richiesta non è JSON valido' }, { status: 400 });
    }
    const { schema: currentSchemaRaw, message, lang = 'it' } = body;

    if (!currentSchemaRaw || typeof currentSchemaRaw !== 'object') {
      return NextResponse.json({ success: false, error: 'schema è richiesto', code: 'MISSING_INPUT' }, { status: 400 });
    }
    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ success: false, error: 'message è richiesto', code: 'MISSING_INPUT' }, { status: 400 });
    }

    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Autenticazione richiesta', code: 'UNAUTHORIZED' }, { status: 401 });
    }
    const token = authHeader.slice(7);
    const user = await getUserFromToken(supabase, token);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Utente non autenticato', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    // Rate limit (Fase 6B): a differenza di create/publish/generate, questa
    // route non è gated da canCreateApp (nessuno slot da consumare, edit via
    // chat su uno schema non ancora persistito) — senza un limite, qualunque
    // account autenticato può richiamarla senza freno, ciascuna chiamata è
    // una generazione AI reale a pagamento. Chiave utente+IP: stesso pattern
    // di chat/route.ts (`chat:${userId}`), con l'IP in più per non fidarsi
    // del solo userId se lo stesso account viene condiviso/compromesso.
    const { allowed } = await checkRateLimit(`creator-refactor:${user.id}:${getClientIp(request)}`, 60, 15);
    if (!allowed) {
      return NextResponse.json({ success: false, error: 'Troppe richieste, riprova tra poco.', code: 'RATE_LIMITED' }, { status: 429 });
    }

    // Non fidarsi del JSON ricevuto dal client come "verità": è lo stesso
    // schema restituito da /api/creator/generate o da una chiamata precedente
    // a questa route, ma potrebbe essere stato manomesso — ri-sanitizzato
    // prima di usarlo sia come contesto per l'AI sia come base del merge di
    // sicurezza.
    const currentSchema = sanitizeSiteBlueprint(currentSchemaRaw);
    if (!currentSchema) {
      return NextResponse.json({ success: false, error: 'Lo schema fornito non è valido', code: 'INVALID_SCHEMA' }, { status: 400 });
    }

    const userMessage = `SCHEMA ATTUALE:\n${JSON.stringify(currentSchema)}\n\nMODIFICA RICHIESTA (lingua: ${lang}):\n${message.trim()}`;

    let content: string;
    try {
      const result = await callAiRouter({
        task: 'schema-edit',
        messages: [
          { role: 'system', content: REFACTOR_SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        context: { userId: user.id, appId: (body.appId as string) || undefined },
      });
      content = result.content;
    } catch (err) {
      console.error('[creator/refactor] AI error:', err);
      if (err instanceof AiRouterConfigError) {
        return NextResponse.json({ success: false, error: 'Servizio AI non configurato correttamente. Contatta il supporto.', code: 'AI_CONFIG_ERROR' }, { status: 500 });
      }
      if (err instanceof AiRouterError) {
        return NextResponse.json({ success: false, error: err.message, code: 'AI_PROVIDER_ERROR' }, { status: 502 });
      }
      throw err;
    }

    let rawUpdated: unknown;
    try {
      rawUpdated = extractJsonFromAiContent(content);
    } catch (err) {
      console.error('[creator/refactor] JSON parse error:', err, content);
      return NextResponse.json({ success: false, error: 'La modifica non ha prodotto uno schema valido, riprova riformulando la richiesta', code: 'INVALID_SCHEMA' }, { status: 500 });
    }

    const updated = sanitizeSiteBlueprint(rawUpdated);
    if (!updated) {
      return NextResponse.json({ success: false, error: 'La modifica non ha prodotto uno schema valido, riprova riformulando la richiesta', code: 'INVALID_SCHEMA' }, { status: 500 });
    }

    const finalSchema = restoreDanglingEntities(updated, currentSchema);

    return NextResponse.json({ success: true, data: { schema: finalSchema } });
  } catch (err) {
    console.error('[creator/refactor] error:', err);
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Errore interno del server',
      code: 'INTERNAL_ERROR',
    }, { status: 500 });
  }
}
