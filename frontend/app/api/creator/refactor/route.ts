// ─── Creator AI Refactor API Route (Next.js App Router) ────────────────────────────
// Modifica in tempo reale lo schema di un progetto Sito/PWA (site-schema.ts)
// via chat: riceve lo schema corrente + un messaggio in linguaggio naturale,
// restituisce lo schema aggiornato.
//
// CreatorAI Engine 2.0, Fase 6 — due strategie, in quest'ordine:
// 1. Patch SCOPED (RFC6902/JSON Patch, creator-patch-engine.ts): il modello
//    restituisce solo le operazioni necessarie, applicate allo schema
//    corrente e validate (structural + runValidator, Fase 5 riusato).
// 2. Fallback OBBLIGATORIO — "JSON completo modificato" (strategia storica,
//    INVARIATA): se la patch è malformata/ambigua/semanticamente invalida o
//    causa una perdita di dati non dichiarata, si ricade automaticamente
//    sulla riscrittura completa già in produzione da prima di questa fase,
//    stessa identica logica/prompt di sempre (mai rimossa, vedi requisito
//    Fase 6 punto 2) — a patto di validare sempre l'output e proteggersi
//    dalla perdita di campi non toccati (vedi restoreDanglingEntities sotto,
//    riusata da ENTRAMBE le strategie).
// Ogni tentativo (patch e/o fallback) è tracciato in generation_jobs (Fase 5,
// riusato invariato) — isolato per tenant, mai un nuovo sistema di persistenza.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { callAiRouter, extractJsonFromAiContent, AiRouterError, AiRouterConfigError, AiBudgetExceededError } from '@/src/lib/ai-router';
import { getUserFromToken, getOrCreateTenant } from '@/src/lib/creator-server';
import { checkRateLimit, getClientIp } from '@/src/lib/rate-limit';
import {
  sanitizeSiteBlueprint,
  type SiteBlueprintJSON,
  type AdminEntity,
} from '@/src/lib/site-schema';
import { captureError } from '@/src/lib/error-tracking';
// CreatorAI Engine 2.0, Fase 6: refactor scoped tramite patch RFC6902,
// tentato PRIMA della riscrittura completa storica (che resta invariata più
// sotto, nel blocco "Fallback OBBLIGATORIO", come unico fallback — mai
// rimossa). applyAndValidatePatch riusa runValidator (Fase 5) — nessuna
// seconda validazione parallela.
import { applyAndValidatePatch } from '@/src/lib/creator-patch-engine';
// Integrazione con generation_jobs (Fase 5, riusato qui invariato): ogni
// tentativo di refactor (patch o fallback) diventa un job osservabile,
// isolato per tenant — stesso store, nessun nuovo sistema di persistenza.
import { createGenerationJob, updateGenerationJob, type GenerationJobRow } from '@/src/lib/creator-generation-jobs';

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

// ─── Fase 6: prompt per il tentativo "patch scoped" (tentato PRIMA di
// REFACTOR_SYSTEM_PROMPT sopra) — stesso tier AI "schema-edit", stessa unica
// chiamata a callAiRouter, solo un formato di risposta diverso (una patch
// invece dello schema intero). Le regole di dominio (colori, vocabolario
// sezioni, relation/state/ruoli) sono le stesse di REFACTOR_SYSTEM_PROMPT,
// riformulate nell'idioma "operazione" invece di "campo dello schema intero".
const PATCH_SYSTEM_PROMPT = `Sei ShardApps Copilot, l'assistente che modifica dal vivo lo schema JSON di un sito/PWA generato da ShardApps — qui produci una PATCH SCOPED (RFC6902/JSON Patch), non l'intero schema riscritto.

Riceverai lo SCHEMA JSON ATTUALE completo (con gli indici di array così come sono, es. adminPanel.entities[0], pages[0].sections[2]) e un MESSAGGIO dell'utente che descrive una modifica.

Rispondi SOLO con un JSON nella forma {"patch":[...operazioni RFC6902...]}, nessun testo prima o dopo, nessun blocco markdown. Ogni operazione è una di:
- {"op":"add","path":"/puntatore","value":...}
- {"op":"remove","path":"/puntatore"}
- {"op":"replace","path":"/puntatore","value":...}
- {"op":"move","path":"/puntatore/destinazione","from":"/puntatore/origine"}
- {"op":"copy","path":"/puntatore/destinazione","from":"/puntatore/origine"}
"path"/"from" sono JSON Pointer (RFC6901) risolti contro lo SCHEMA ATTUALE fornito: usa gli indici numerici degli array esattamente come appaiono in quello schema (es. "/adminPanel/entities/1/fields/2"), oppure "-" per appendere in coda a un array (es. "/adminPanel/entities/0/fields/-").

Regole tassative:
1. La patch deve essere SCOPED: solo le operazioni necessarie per la modifica richiesta (indicativamente non più di una decina). Se la richiesta è troppo ampia/strutturale per una patch mirata, produci comunque il tuo miglior tentativo — se non è esprimibile in modo scoped, il sistema ricade automaticamente sulla riscrittura completa.
2. Per RIMUOVERE un'entità, un campo, una pagina o una sezione usa SEMPRE un'operazione "remove" esplicita sul suo path esatto — MAI una "replace" di un array/oggetto padre che la ometta implicitamente: una rimozione non esplicita viene rifiutata come possibile perdita di dati accidentale e fa scattare il fallback.
3. Se la modifica riguarda un colore, "replace" su "/ui/primaryColor" (formato esadecimale "#rrggbb").
4. Se la modifica aggiunge una sezione a una pagina, usa uno di questi "type" (nessun altro ammesso): hero, about, gallery, list, form, contact, reviews, cta, text.
5. Se la modifica aggiunge/rimuove un'entità del pannello admin, aggiorna con "replace"/"remove"/"add" anche i riferimenti "entity" nelle sezioni "list"/"form" delle pagine che la referenziano — non lasciare riferimenti a entità inesistenti.
6. Se l'utente chiede di collegare un'entità a un'altra, usa "replace"/"add" per impostare sul campo "type":"relation","targetEntity" (il "name" esatto di un'altra entità già presente nello schema) e "displayField" (l'"id" di un campo reale di quell'entità, mai "id").
7. Se l'utente chiede un flusso di lavoro (stati/transizioni) o ruoli/utenti diversi, usa "add"/"replace" sui campi "type":"state"/"states"/"allowedTransitions"/"actions" dell'entità, oppure su "authConfig" (enabled/supportedRoles/defaultRole) — stessa semantica già nota per lo schema completo.`;

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
    const appIdFromBody = (body.appId as string) || null;
    const aiContext = { userId: user.id, appId: appIdFromBody || undefined };

    // Tenant isolation (requisito Fase 6) + integrazione con generation_jobs
    // (Fase 5, riusato invariato): ogni tentativo di refactor, patch o
    // fallback, diventa un job osservabile isolato per tenant.
    const tenantId = await getOrCreateTenant(supabase, user, token);
    let job: GenerationJobRow = await createGenerationJob(supabase, {
      tenantId,
      appId: appIdFromBody,
      createdBy: user.id,
      userPrompt: message.trim(),
      context: { mode: 'refactor', lang },
    });

    // ─── Tentativo 1: patch scoped RFC6902 (Fase 6) ───────────────────────
    try {
      job = await updateGenerationJob(supabase, job.id, { status: 'generating', current_step: 'patch:generate' });
      const patchAiResult = await callAiRouter({
        task: 'schema-edit',
        messages: [
          { role: 'system', content: PATCH_SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        context: { ...aiContext, tenantId },
      });
      const rawPatchWrapper = extractJsonFromAiContent(patchAiResult.content) as { patch?: unknown };

      job = await updateGenerationJob(supabase, job.id, { status: 'validating', current_step: 'patch:validate' });
      // Struttura RFC6902 + applicazione + nessuna perdita di dati non
      // dichiarata + runValidator (Fase 5, RIUSATO, non duplicato) — tutto
      // dentro applyAndValidatePatch, questa route non reimplementa nulla.
      const patchValidation = applyAndValidatePatch(currentSchema, rawPatchWrapper?.patch);

      if (patchValidation.ok && patchValidation.schema) {
        const finalSchema = restoreDanglingEntities(patchValidation.schema, currentSchema);
        await updateGenerationJob(supabase, job.id, {
          status: 'ready',
          current_step: 'ready',
          specification: patchValidation.specification,
        });
        return NextResponse.json({ success: true, data: { schema: finalSchema }, jobId: job.id, mode: 'patch' });
      }

      job = await updateGenerationJob(supabase, job.id, {
        current_step: 'patch:invalid',
        artifacts: { ...job.artifacts, patchErrors: patchValidation.errors },
      });
    } catch (patchErr) {
      // Qualunque eccezione qui (AI non raggiungibile, JSON non estraibile,
      // ecc.) è un segnale di fallback, MAI un errore fatale per questa
      // richiesta — requisito Fase 6 punto 2: la riscrittura completa resta
      // OBBLIGATORIA come fallback automatico. Il bookkeeping stesso è
      // best-effort: se anche l'update fallisce non deve bloccare il
      // fallback, che è la parte che conta davvero per l'utente.
      job = await updateGenerationJob(supabase, job.id, {
        current_step: 'patch:exception',
        artifacts: { ...job.artifacts, patchException: patchErr instanceof Error ? patchErr.message : String(patchErr) },
      }).catch(() => job);
    }

    // ─── Fallback OBBLIGATORIO: riscrittura completa (strategia storica, INVARIATA) ──
    job = await updateGenerationJob(supabase, job.id, {
      status: 'generating',
      current_step: 'fallback:full-rewrite',
      fallback_used: true,
    }).catch(() => job);

    let content: string;
    try {
      const result = await callAiRouter({
        task: 'schema-edit',
        messages: [
          { role: 'system', content: REFACTOR_SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        context: { ...aiContext, tenantId },
      });
      content = result.content;
    } catch (err) {
      console.error('[creator/refactor] AI error:', err);
      await updateGenerationJob(supabase, job.id, {
        status: 'failed',
        current_step: 'failed',
        error: err instanceof Error ? err.message : String(err),
      }).catch(() => {});
      if (err instanceof AiRouterConfigError) {
        return NextResponse.json({ success: false, error: 'Servizio AI non configurato correttamente. Contatta il supporto.', code: 'AI_CONFIG_ERROR' }, { status: 500 });
      }
      if (err instanceof AiBudgetExceededError) {
        return NextResponse.json({ success: false, error: err.message, code: 'AI_BUDGET_EXCEEDED' }, { status: 429 });
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
      await updateGenerationJob(supabase, job.id, { status: 'failed', current_step: 'failed', error: 'JSON parse error sulla riscrittura completa' }).catch(() => {});
      return NextResponse.json({ success: false, error: 'La modifica non ha prodotto uno schema valido, riprova riformulando la richiesta', code: 'INVALID_SCHEMA' }, { status: 500 });
    }

    const updated = sanitizeSiteBlueprint(rawUpdated);
    if (!updated) {
      await updateGenerationJob(supabase, job.id, { status: 'failed', current_step: 'failed', error: 'sanitizeSiteBlueprint ha rifiutato lo schema riscritto' }).catch(() => {});
      return NextResponse.json({ success: false, error: 'La modifica non ha prodotto uno schema valido, riprova riformulando la richiesta', code: 'INVALID_SCHEMA' }, { status: 500 });
    }

    const finalSchema = restoreDanglingEntities(updated, currentSchema);

    await updateGenerationJob(supabase, job.id, { status: 'ready', current_step: 'ready' }).catch(() => {});

    return NextResponse.json({ success: true, data: { schema: finalSchema }, jobId: job.id, mode: 'full-rewrite', fallbackUsed: true });
  } catch (err) {
    captureError('creator.refactor', err, { url: request.url });
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Errore interno del server',
      code: 'INTERNAL_ERROR',
    }, { status: 500 });
  }
}
