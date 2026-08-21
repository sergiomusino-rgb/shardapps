// ─── Creator AI Generate API Route (Next.js App Router) ───────────────────────────────
// Genera lo schema JSON di anteprima tramite OpenRouter (Claude Sonnet 5), CON
// INIEZIONE DEL DESIGN SYSTEM. Non salva nulla: la persistenza avviene solo
// dopo conferma dell'utente su /api/creator/create (vedi DynamicAppPreview).

import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { getDesignSystemForSector } from '@/lib/designSystemLoader';
import { sanitizeBlueprint, normalizeSector } from '@/src/lib/blueprint-schema';
import { sanitizeSiteBlueprint, ProjectTypeSchema, type ProjectType } from '@/src/lib/site-schema';
import { callAiRouter, extractJsonFromAiContent, AiRouterError, AiRouterConfigError, AiBudgetExceededError } from '@/src/lib/ai-router';
import {
  getUserFromToken,
  getOrCreateTenant,
  canCreateApp,
} from '@/src/lib/creator-server';
import { checkRateLimit, getClientIp } from '@/src/lib/rate-limit';
import { captureError } from '@/src/lib/error-tracking';
// CreatorAI Engine 2.0, Fase 5 (AI Agent Orchestrator): il ramo "sito/PWA"
// (projectType) sotto passa dal processo planner->generator->validator->
// repair persistito in generation_jobs — runGenerationPipeline per il
// perché/contratto (P0-1, root-cause report "async generation / client-
// server lifecycle mismatch": il job viene ora creato SINCRONAMENTE qui
// sotto, per rispondere subito con jobId, e la pipeline continua dentro
// after() — runGenerationPipeline è la stessa logica di sempre, solo
// estratta da runGenerationOrchestrator perché il chiamante possa creare il
// job prima di avviarla, invece di lasciarla creare un job al suo interno).
import { runGenerationPipeline } from '@/src/lib/creator-ai-orchestrator';
import {
  createGenerationJob,
  updateGenerationJob,
  computePromptFingerprint,
  findRecentEquivalentJob,
  type GenerationJobRow,
} from '@/src/lib/creator-generation-jobs';
// callSiteSchemaGenerator/fillBusinessConfigDefaults/ensureGestionaleHasPages:
// stesso codice di prima, solo spostato in un modulo dedicato (Fase 5) perché
// l'orchestrator possa riusarli senza duplicarli — vedi creator-site-generator.ts.
import {
  callSiteSchemaGenerator,
  fillBusinessConfigDefaults,
  ensureGestionaleHasPages,
} from '@/src/lib/creator-site-generator';

// P0-3 (root-cause report): NON aumenta il timeout AI per singola chiamata
// (AI_ROUTER_TIMEOUT_MS resta 30000, invariato in ai-router.ts) né i retry
// (MAX_RETRIES/MAX_REPAIR_RETRIES invariati) — imposta solo il tetto di
// durata della funzione serverless così la pipeline in background (after())
// non venga troncata a metà da un default di piattaforma mai configurato
// esplicitamente, lasciando un job bloccato in uno stato non terminale.
// Margine ampio sopra il caso peggiore teorico invariato (planner + generator
// + fino a 2 repair, ciascuno fino a 2 tentativi da 30s, + l'eventuale
// generator del fallback): ordine di grandezza qualche minuto, vedi lo
// stesso calcolo in IDEMPOTENCY_WINDOW_MS (creator-generation-jobs.ts).
// Il ceiling REALE dipende dal piano Vercel — da verificare live, vedi
// report finale.
export const maxDuration = 300;

// Duplicato intenzionalmente da src/lib/LanguageContext.tsx (SUPPORTED_LOCALES):
// quel modulo è 'use client' e importarlo da una route API server-side
// trascinerebbe inutilmente i dizionari i18n nel bundle server.
const SUPPORTED_LOCALES = ['it', 'en', 'fr', 'de', 'es'] as const;

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

  const systemPrompt = `Sei ShardApps AI, un assistente specializzato nella generazione di applicazioni SaaS.
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


// ─── P0-1 (async generation): esegue la pipeline reale su un job GIA'
// creato e persiste il risultato finale — chiamata da dentro after() (la
// risposta HTTP con jobId è già stata inviata al client). Stessa strategia
// di fallback già esistente (Fase 5 punto 7): se l'orchestrator stesso
// fallisce (errore infrastrutturale, non di validazione), si ricade sulla
// generazione diretta — qui il risultato finisce comunque nello STESSO job,
// mai una risposta invisibile al polling. Ogni ramo termina SEMPRE il job in
// 'ready' o 'failed' (P0-3: mai uno stato intermedio indefinito per un
// errore imprevisto qui) — se anche l'ultimo update di bookkeeping fallisse,
// il job resta comunque nello stato che il proprio catch interno di
// runGenerationPipeline gli ha già assegnato prima di rilanciare.
async function finalizeGenerationJob(params: {
  supabase: ReturnType<typeof createClient<Database>>;
  job: GenerationJobRow;
  tenantId: string;
  userId: string;
  userPrompt: string;
  projectType: ProjectType;
  lang: string;
  generate: (promptWithContext: string) => Promise<unknown>;
  postProcess: (raw: unknown) => unknown;
}): Promise<void> {
  const { supabase, job, tenantId, userId, userPrompt, projectType, lang, generate, postProcess } = params;

  try {
    const result = await runGenerationPipeline(
      { supabase, tenantId, userId, appId: null, userPrompt, projectType, lang, generate, postProcessRawSchema: postProcess },
      job
    );

    if (result.status === 'ready' && result.schema) {
      const blueprint = fillBusinessConfigDefaults(result.schema, lang);
      await updateGenerationJob(supabase, result.job.id, { result_schema: blueprint });
    }
    // status === 'failed': runGenerationPipeline ha già persistito
    // error/status, nulla altro da fare qui.
  } catch (orchestratorErr) {
    // ─── Fallback legacy (Fase 5 punto 7), stesso comportamento di prima,
    // ora persistito sullo STESSO job invece che restituito direttamente
    // nella risposta HTTP (che a questo punto è già stata inviata). ───────
    captureError('creator.generate.orchestrator_fallback', orchestratorErr, { projectType, tenantId, userId });
    try {
      const rawSchema = postProcess(await generate(userPrompt));
      const sanitized = sanitizeSiteBlueprint(rawSchema);
      if (!sanitized) {
        await updateGenerationJob(supabase, job.id, {
          status: 'failed',
          current_step: 'failed',
          error: 'Lo schema generato non è valido, riprova con un prompt più specifico',
          fallback_used: true,
        }).catch(() => {});
        return;
      }
      const blueprint = fillBusinessConfigDefaults(sanitized, lang);
      await updateGenerationJob(supabase, job.id, {
        status: 'ready',
        current_step: 'ready:fallback',
        result_schema: blueprint,
        fallback_used: true,
        error: null,
      }).catch(() => {});
    } catch (fallbackErr) {
      captureError('creator.generate', fallbackErr, { projectType, tenantId, userId });
      let message = fallbackErr instanceof Error ? fallbackErr.message : 'Errore interno del server';
      if (fallbackErr instanceof AiRouterConfigError) message = 'Servizio AI non configurato correttamente. Contatta il supporto.';
      else if (fallbackErr instanceof AiBudgetExceededError) message = fallbackErr.message;
      else if (fallbackErr instanceof AiRouterError) message = fallbackErr.message;
      await updateGenerationJob(supabase, job.id, {
        status: 'failed',
        current_step: 'failed',
        error: message,
        fallback_used: true,
      }).catch(() => {});
    }
  }
}

// ─── POST /api/creator/generate ───────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Body della richiesta non è JSON valido' }, { status: 400 });
    }
    const { userPrompt, sector, lang: rawLang } = body;
    const safeSector = sector || 'saas';
    // Whitelist esplicita: non fidarsi di una stringa libera dal body per un
    // valore che finisce sia nel prompt del modello sia in businessConfig.language.
    const lang = (SUPPORTED_LOCALES as readonly string[]).includes(rawLang) ? rawLang : 'it';

    // Motore Sito/PWA (site-schema.ts): attivo solo quando il chiamante
    // passa esplicitamente `projectType` (vedi ProjectWizard.tsx). Ramo
    // separato e non distruttivo: il flusso storico sector-based sotto
    // (dashboard/creator, Template Verticali) resta invariato per chi non lo
    // passa, quindi questa route continua a servire entrambi i motori senza
    // che l'uno rompa l'altro.
    const projectTypeParse = ProjectTypeSchema.safeParse(body.projectType);
    if (projectTypeParse.success) {
      const projectType = projectTypeParse.data;

      if (!userPrompt || typeof userPrompt !== 'string' || !userPrompt.trim()) {
        return NextResponse.json({
          success: false,
          error: 'userPrompt è richiesto',
          code: 'MISSING_INPUT',
        }, { status: 400 });
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

      // Rate limit (Fase 6C): stesso meccanismo/chiave di creator/refactor
      // (userId+IP) — questa route non consuma slot (è solo anteprima),
      // quindi senza un limite un tenant con slot residui può generare
      // anteprime AI illimitate.
      const { allowed: rateAllowed } = await checkRateLimit(`creator-generate:${user.id}:${getClientIp(request)}`, 60, 15);
      if (!rateAllowed) {
        return NextResponse.json({ success: false, error: 'Troppe richieste, riprova tra poco.', code: 'RATE_LIMITED' }, { status: 429 });
      }

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
        return NextResponse.json({ success: false, error: reason || 'Errore controllo limite app', code: 'SLOTS_CHECK_ERROR' }, { status: 500 });
      }

      // ─── P0-2 (idempotenza) ─────────────────────────────────────────────
      // Un secondo POST con lo stesso tenant+utente+projectType+lang+prompt
      // (tipicamente l'utente che ritenta dopo un falso "errore di
      // connessione", vedi root-cause report) NON deve creare un secondo job
      // né una seconda app: se un job equivalente esiste già ed è ancora in
      // corso o è già pronto, lo si riusa. Un job FALLITO non blocca un
      // nuovo tentativo esplicito (requisito Fase 6C del task).
      const promptFingerprint = computePromptFingerprint({ tenantId, createdBy: user.id, projectType, lang, userPrompt });
      let existingJob: GenerationJobRow | null = null;
      try {
        existingJob = await findRecentEquivalentJob(supabase, { tenantId, createdBy: user.id, promptFingerprint });
      } catch (err) {
        // Fail-open (stesso principio del budget check in ai-router.ts): un
        // problema nostro nella query di idempotenza non deve mai impedire
        // una generazione altrimenti legittima.
        captureError('creator.generate.idempotency_check_failed', err, { tenantId, userId: user.id });
      }

      if (existingJob && existingJob.status === 'ready') {
        return NextResponse.json({
          success: true,
          data: { schema: existingJob.result_schema },
          jobId: existingJob.id,
          status: 'ready',
          fallbackUsed: existingJob.fallback_used,
          deduped: true,
        });
      }
      if (existingJob && existingJob.status !== 'failed') {
        // planning/generating/validating/repairing: già in corso, stesso job.
        return NextResponse.json({
          success: true,
          jobId: existingJob.id,
          status: existingJob.status,
          current_step: existingJob.current_step,
          deduped: true,
        }, { status: 202 });
      }

      // ─── P0-1 (generazione asincrona) ───────────────────────────────────
      // Il job viene creato QUI, sincronamente (un semplice insert, non una
      // chiamata AI) — la risposta HTTP parte subito con jobId, la pipeline
      // reale (Planner->Generator->Validator->Repair, invariata — vedi
      // runGenerationPipeline in creator-ai-orchestrator.ts) continua dentro
      // after() (next/server), che estende l'esecuzione della funzione
      // serverless oltre l'invio della risposta senza tenere la connessione
      // del client aperta. La UI fa polling su GET /api/creator/generate/
      // status/[jobId] (vedi quella route) finché status non è ready/failed.
      let job: GenerationJobRow;
      try {
        job = await createGenerationJob(supabase, {
          tenantId, appId: null, createdBy: user.id, userPrompt,
          context: { projectType, lang }, promptFingerprint,
        });
      } catch (err) {
        captureError('creator.generate.job_create_failed', err, { projectType, tenantId, userId: user.id });
        return NextResponse.json({ success: false, error: 'Errore interno del server', code: 'INTERNAL_ERROR' }, { status: 500 });
      }

      const generatorFn = (promptWithContext: string) =>
        callSiteSchemaGenerator(promptWithContext, projectType, lang, { userId: user.id, tenantId });
      const postProcess = (raw: unknown) => ensureGestionaleHasPages(raw, projectType);

      const runToCompletion = () => finalizeGenerationJob({
        supabase, job, tenantId, userId: user.id, userPrompt, projectType, lang,
        generate: generatorFn, postProcess,
      });

      try {
        // In produzione (Next.js su Vercel, dentro una vera richiesta HTTP)
        // schedula il lavoro DOPO l'invio della risposta — vedi doc after().
        after(runToCompletion);
      } catch {
        // after() lancia sincronamente fuori da uno "scope di richiesta"
        // reale (es. i test che chiamano l'handler direttamente, senza
        // passare dal dispatcher di Next.js — vedi route.test.ts). Nessuna
        // finestra silenziosa: si esegue comunque la pipeline PRIMA di
        // rispondere, degradando semplicemente al comportamento sincrono di
        // sempre per quella singola chiamata, invece di perdere il lavoro.
        await runToCompletion();
      }

      return NextResponse.json({
        success: true,
        jobId: job.id,
        status: job.status,
        current_step: job.current_step,
      }, { status: 202 });
    }

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

    // Rate limit (Fase 6C): stesso meccanismo/chiave di creator/refactor
    // (userId+IP) — ramo storico sector-based, stessa esposizione del ramo
    // Sito/PWA sopra (anteprima non gated da slot).
    const { allowed: rateAllowed } = await checkRateLimit(`creator-generate:${user.id}:${getClientIp(request)}`, 60, 15);
    if (!rateAllowed) {
      return NextResponse.json({
        success: false,
        error: 'Troppe richieste, riprova tra poco.',
        code: 'RATE_LIMITED'
      }, { status: 429 });
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
    captureError('creator.generate', err, { url: request.url });
    if (err instanceof AiRouterConfigError) {
      return NextResponse.json({
        success: false,
        error: 'Servizio AI non configurato correttamente. Contatta il supporto.',
        code: 'AI_CONFIG_ERROR'
      }, { status: 500 });
    }
    if (err instanceof AiBudgetExceededError) {
      return NextResponse.json({
        success: false,
        error: err.message,
        code: 'AI_BUDGET_EXCEEDED'
      }, { status: 429 });
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
