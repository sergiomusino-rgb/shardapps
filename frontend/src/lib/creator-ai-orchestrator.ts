// ─── AI Agent Orchestrator (CreatorAI Engine 2.0 — Fase 5) ─────────────────
// Trasforma la generazione da "singola chiamata AI -> schema" in un processo
// osservabile e persistito:
//
//   PROMPT -> PLANNING -> GENERATION -> VALIDATION -> REPAIR (se necessario)
//          -> READY -> (human approval, invariato) -> PUBLISH
//
// Principi guida di questa fase (vedi anche il report):
// - RIUSA il sistema AI esistente: nessun nuovo provider/modello — il
//   Planner/Repair passano dal solito `callAiRouter` (tier "fast", stesso
//   OpenRouter di sempre), il Generator è iniettato dal chiamante (che passa
//   la funzione REALE già scritta in app/api/creator/generate/route.ts,
//   `callSiteSchemaGenerator` — mai duplicata qui).
// - RIUSA la validazione esistente: `sanitizeSiteBlueprint` (site-schema.ts)
//   + `AppSpecificationSchema`/`toAppSpecificationFromSiteBlueprint`
//   (app-specification.ts) restano l'unica fonte di verità semantica — questo
//   modulo non reimplementa resolveEntityRelations/resolveEntityStatesAndActions.
// - Nessuna coda distribuita: l'intero processo gira dentro la stessa
//   richiesta HTTP che lo ha avviato (stesso modello sincrono di sempre),
//   `generation_jobs` è solo lo stato osservabile persistito, non uno
//   scheduler.
// - Il Planner/Repair non possono MAI pubblicare: l'unico output di questo
//   modulo è una specification pronta per la preview — publish/route.ts
//   resta l'unico varco verso `apps`, invariato, invocato solo da un umano
//   in AppEditorView.

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
// Estensione .ts esplicita (vedi commento in tsconfig.json,
// allowImportingTsExtensions): stesso pattern già usato da site-schema.ts per
// ./blueprint-schema.ts — consente a questo modulo di girare sia sotto
// Next.js (bundler, risolve anche extensionless) sia direttamente via
// `node --test` (resolver ESM nativo, richiede estensione esplicita su un
// import relativo di file .ts).
import { callAiRouter, extractJsonFromAiContent, type AiRouterMessage } from './ai-router.ts';
import { sanitizeSiteBlueprint, coerceObviousNumericFieldTypes, type ProjectType, type SiteBlueprintJSON } from './site-schema.ts';
import { AppSpecificationSchema, toAppSpecificationFromSiteBlueprint, type AppSpecification } from './app-specification.ts';
import {
  createGenerationJob,
  updateGenerationJob,
  type GenerationJobRow,
} from './creator-generation-jobs.ts';

// ─── Planner ─────────────────────────────────────────────────────────────────
// Piano BREVE e strutturato, mai l'app intera — vedi requisito Fase 5, punto 3.
export const GenerationPlanSchema = z.object({
  projectType: z.string(),
  sector: z.string(),
  mainEntities: z.array(z.string()).default([]),
  pages: z.array(z.string()).default([]),
  workflows: z.array(z.string()).default([]),
  keyFeatures: z.array(z.string()).default([]),
});
export type GenerationPlan = z.infer<typeof GenerationPlanSchema>;

export class PlannerError extends Error {}

/** Firma minima di callAiRouter di cui il Planner/Repair hanno bisogno —
 * permette di iniettare un fake nei test senza toccare la rete. */
export type AiCallFn = (options: {
  task: 'app-planning' | 'app-repair';
  messages: AiRouterMessage[];
  jsonMode?: boolean;
  context?: { userId?: string; tenantId?: string };
}) => Promise<{ content: string }>;

const PLANNER_SYSTEM_PROMPT = `Sei il Planner di ShardApps CreatorAI: prima di generare un'intera applicazione, produci un PIANO BREVE e strutturato, non l'app completa.
Rispondi SOLO con un JSON valido con ESATTAMENTE questa struttura, nessun testo prima o dopo:
{
  "projectType": "uno tra landing|webapp-pwa|ecommerce|gestionale, quello già indicato dall'utente",
  "sector": "settore in kebab-case dedotto dal prompt",
  "mainEntities": ["nome_entita_1", "nome_entita_2"],
  "pages": ["home", "altra-pagina-se-serve"],
  "workflows": ["descrizione breve di un eventuale flusso di lavoro/stato, es. 'ordine: nuovo->in_preparazione->pronto'"],
  "keyFeatures": ["caratteristica principale 1", "caratteristica principale 2"]
}
Non generare campi, tabelle dettagliate o pagine complete: solo l'elenco dei nomi/concetti principali. Se il dominio non ha workflow/stati, "workflows" resta []. Non aggiungere testo prima o dopo il JSON.`;

export async function runPlanner(
  input: { userPrompt: string; projectType: ProjectType; lang: string; context?: { userId?: string; tenantId?: string } },
  aiCall: AiCallFn = callAiRouter as unknown as AiCallFn
): Promise<GenerationPlan> {
  const { content } = await aiCall({
    task: 'app-planning',
    jsonMode: true,
    messages: [
      { role: 'system', content: PLANNER_SYSTEM_PROMPT },
      { role: 'user', content: `Tipo progetto: ${input.projectType}. Lingua: ${input.lang}. Richiesta utente: ${input.userPrompt}` },
    ],
    context: input.context,
  });

  let raw: unknown;
  try {
    raw = extractJsonFromAiContent(content);
  } catch (err) {
    throw new PlannerError(`Planner: JSON non valido (${err instanceof Error ? err.message : 'errore sconosciuto'})`);
  }

  const parsed = GenerationPlanSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PlannerError(`Planner: piano non conforme allo schema minimo (${parsed.error.issues.map((i) => i.message).join('; ')})`);
  }
  return parsed.data;
}

/** Riassunto testuale breve del piano, da anteporre al prompt utente passato
 * al Generator REALE (mai una riscrittura del prompt stesso) — "il Generator
 * deve utilizzare il risultato del Planner come contesto" (requisito 4),
 * senza toccare la firma delle funzioni di generazione esistenti. */
export function planToPromptContext(plan: GenerationPlan | null): string {
  if (!plan) return '';
  const lines = [
    `[Piano suggerito — usalo come guida, non come vincolo rigido]`,
    `Settore: ${plan.sector}`,
    plan.mainEntities.length ? `Entità principali: ${plan.mainEntities.join(', ')}` : '',
    plan.pages.length ? `Pagine: ${plan.pages.join(', ')}` : '',
    plan.workflows.length ? `Workflow/stati: ${plan.workflows.join('; ')}` : '',
    plan.keyFeatures.length ? `Caratteristiche chiave: ${plan.keyFeatures.join(', ')}` : '',
  ].filter(Boolean);
  return lines.length > 1 ? `${lines.join('\n')}\n\n` : '';
}

// ─── Validator ───────────────────────────────────────────────────────────────
// Riusa sanitizeSiteBlueprint (site-schema.ts) e AppSpecificationSchema/
// toAppSpecificationFromSiteBlueprint (app-specification.ts) — nessuna
// seconda validazione parallela. I controlli semantici sotto sono, per la
// quasi totalità, già garantiti dal parsing Zod chiuso (discriminated union
// dei 9 section type, AuthConfigSchema per i ruoli) e da
// resolveEntityRelations/resolveEntityStatesAndActions (relation/state già
// degradati/scartati se non validi) — qui si verifica ESPLICITAMENTE che
// nessun riferimento rotto sia sopravvissuto, in difesa in profondità.
// ─── Errori strutturati (CreatorAI v2) ──────────────────────────────────────
// Prima runValidator produceva solo stringhe leggibili (usate direttamente
// nel prompt del Repair Agent, invariato). `issues` aggiunge la stessa
// informazione in forma strutturata {severity, code, path, message} — per
// osservabilità (generation_jobs.artifacts) e per distinguere ERRORI (che
// contano ai fini di ok/false e attivano il repair, invariato) da WARNING
// (mai bloccanti, mai un motivo di repair — "meglio un warning che
// un'invenzione"). `errors: string[]` resta invariato per compatibilità con
// runRepair, che continua a ricevere lo stesso elenco di sempre.
export type ValidationSeverity = 'error' | 'warning';
export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  issues?: ValidationIssue[];
  sanitized?: SiteBlueprintJSON;
  specification?: AppSpecification;
}

export function runValidator(rawSchema: unknown): ValidationResult {
  const sanitized = sanitizeSiteBlueprint(rawSchema);
  if (!sanitized) {
    const message = 'Lo schema generato non è valido (sanitizeSiteBlueprint ha rifiutato l\'input: nessuna pagina recuperabile).';
    return {
      ok: false,
      errors: [message],
      issues: [{ severity: 'error', code: 'SCHEMA_UNRECOVERABLE', path: '', message }],
    };
  }

  const specParse = AppSpecificationSchema.safeParse(toAppSpecificationFromSiteBlueprint(sanitized));
  if (!specParse.success) {
    return {
      ok: false,
      errors: specParse.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      issues: specParse.error.issues.map((i) => ({
        severity: 'error' as const,
        code: 'SPEC_SCHEMA_INVALID',
        path: i.path.join('.'),
        message: i.message,
      })),
      sanitized,
    };
  }
  const specification = specParse.data;

  const errors: string[] = [];
  const issues: ValidationIssue[] = [];
  const entityNames = new Set(specification.entities.map((e) => e.name));

  // entities: almeno un'entità per un progetto che non sia una pura landing
  // vuota è già imposto a monte (AdminEntitySchema/EntitySchema richiedono
  // min(1) field, non zero entità qui) — nessun controllo aggiuntivo
  // necessario, il conteggio è già coerente per costruzione.

  // relations: nessun targetEntity dovrebbe poter sopravvivere se non risolto
  // (resolveEntityRelations degrada già a 'text'), verificato comunque come
  // rete di sicurezza esplicita.
  for (const entity of specification.entities) {
    for (const field of entity.fields) {
      if (field.type === 'relation' && field.targetEntity && !entityNames.has(field.targetEntity)) {
        const message = `Entità "${entity.name}", campo "${field.id}": relation verso "${field.targetEntity}" che non esiste tra le entità.`;
        errors.push(message);
        issues.push({ severity: 'error', code: 'RELATION_TARGET_MISSING', path: `adminPanel.entities.${entity.name}.fields.${field.id}`, message });
      }
      // states/actions: targetState deve appartenere agli `states` dello
      // stesso campo — stessa rete di sicurezza esplicita.
      if (field.type === 'state' && field.states) {
        const stateSet = new Set(field.states);
        for (const action of entity.actions ?? []) {
          if (action.type === 'change_state' && action.targetState && !stateSet.has(action.targetState)) {
            const message = `Entità "${entity.name}", azione "${action.id}": targetState "${action.targetState}" non è tra gli states del campo "${field.id}".`;
            errors.push(message);
            issues.push({ severity: 'error', code: 'ACTION_TARGET_STATE_INVALID', path: `adminPanel.entities.${entity.name}.actions.${action.id}`, message });
          }
        }
      }
    }
  }

  // pages/component types: PageSectionSchema è una discriminated union
  // CHIUSA sui 9 type noti (site-schema.ts) — un `type` non riconosciuto non
  // sopravvive nemmeno al parse Zod dentro sanitizeSiteBlueprint, quindi ogni
  // sezione qui ha già un type valido per costruzione. Verifichiamo solo che
  // le sezioni "list"/"form" puntino a un'entità esistente (stessa garanzia
  // "nessun riferimento rotto" delle relation sopra).
  for (const page of specification.pages ?? []) {
    for (const section of page.sections) {
      if ((section.type === 'list' || section.type === 'form') && section.entity && !entityNames.has(section.entity)) {
        const message = `Pagina "${page.slug}", sezione "${section.type}": entity "${section.entity}" non esiste tra le entità.`;
        errors.push(message);
        issues.push({ severity: 'error', code: 'SECTION_ENTITY_MISSING', path: `pages.${page.slug}`, message });
      }
    }
  }

  // ruoli: AuthConfigSchema garantisce già supportedRoles ⊆ {admin,operator,
  // viewer} e defaultRole ⊆ {operator,viewer} a livello di parse — nessun
  // valore fuori vocabolario può arrivare qui.

  // workflow references (Fase 4): site-schema.ts non espone ancora un campo
  // `workflows` a livello di SiteBlueprintJSON/AppSpecification (il motore
  // Workflow/Logic — backend/lib/workflow-model.js/event-router.js — legge
  // `apps.config.workflows` direttamente, non ancora integrato nello schema
  // Zod del frontend). Controllo difensivo, si attiva automaticamente se/
  // quando quel campo verrà aggiunto: nessun'azione richiesta oggi.
  const rawWorkflows = (rawSchema as { workflows?: unknown } | null)?.workflows;
  if (Array.isArray(rawWorkflows)) {
    for (const wf of rawWorkflows as Array<Record<string, unknown>>) {
      const trigger = wf?.trigger as Record<string, unknown> | undefined;
      const triggerEntity = typeof trigger?.entity === 'string' ? trigger.entity : undefined;
      if (triggerEntity && !entityNames.has(triggerEntity)) {
        const message = `Workflow "${String(wf?.id ?? wf?.name ?? '?')}": trigger.entity "${triggerEntity}" non esiste tra le entità.`;
        errors.push(message);
        issues.push({ severity: 'error', code: 'WORKFLOW_TRIGGER_ENTITY_MISSING', path: `workflows.${String(wf?.id ?? wf?.name ?? '?')}`, message });
      }
      for (const action of Array.isArray(wf?.actions) ? (wf.actions as Array<Record<string, unknown>>) : []) {
        if (action?.type === 'create_related_record' && typeof action.targetEntity === 'string' && !entityNames.has(action.targetEntity)) {
          const message = `Workflow "${String(wf?.id ?? wf?.name ?? '?')}": create_related_record verso "${action.targetEntity}" che non esiste.`;
          errors.push(message);
          issues.push({ severity: 'error', code: 'WORKFLOW_ACTION_TARGET_MISSING', path: `workflows.${String(wf?.id ?? wf?.name ?? '?')}`, message });
        }
      }
    }
  }

  // dashboardCards (CreatorAI v2): stesso controllo di resolveDashboardCards
  // (site-schema.ts) — "sum"/"avg" richiede un campo numerico REALE — ma reso
  // esplicito qui invece di scartare la card in silenzio. Severity "warning",
  // MAI "error": una card scartata non impedisce mai la pubblicazione
  // dell'app (comportamento pre-esistente, invariato — vedi
  // resolveDashboardCards), quindi non deve mai far fallire l'intera
  // generazione dopo aver esaurito i tentativi di repair. La correzione
  // deterministica "sicura" (coerceObviousNumericFieldTypes, applicata PRIMA
  // di runValidator in runGenerationOrchestrator) risolve già i casi
  // palesemente ovvi senza bisogno di repair via AI; questo warning segnala
  // solo i casi residui, per osservabilità (generation_jobs.artifacts).
  const rawDashboardCards = (rawSchema as { dashboardCards?: unknown } | null)?.dashboardCards;
  if (Array.isArray(rawDashboardCards)) {
    const entityByName = new Map(specification.entities.map((e) => [e.name, e]));
    (rawDashboardCards as Array<Record<string, unknown>>).forEach((card, i) => {
      const table = typeof card?.table === 'string' ? card.table : undefined;
      const type = typeof card?.type === 'string' ? card.type : 'count';
      const label = typeof card?.label === 'string' ? card.label : `#${i}`;
      if (!table || !entityByName.has(table)) {
        issues.push({
          severity: 'warning',
          code: 'DASHBOARD_CARD_TABLE_MISSING',
          path: `dashboardCards.${i}`,
          message: `dashboardCards[${i}] ("${label}"): "table" ("${table ?? ''}") non corrisponde a nessuna entità reale — la card verrà scartata.`,
        });
        return;
      }
      if (type === 'sum' || type === 'avg') {
        const entity = entityByName.get(table)!;
        const cardField = typeof card?.field === 'string' ? card.field : undefined;
        const field = entity.fields.find((f) => f.id === cardField);
        const fieldOk = field && (field.type === 'number' || field.type === 'currency');
        if (!fieldOk) {
          issues.push({
            severity: 'warning',
            code: 'DASHBOARD_FIELD_TYPE_MISMATCH',
            path: `dashboardCards.${i}`,
            message: `dashboardCards[${i}] ("${label}"): tipo "${type}" richiede un campo numerico REALE su "${table}" — "${cardField ?? ''}" ${field ? `ha type "${field.type}"` : 'non esiste'} — la card verrà scartata.`,
          });
        }
      }
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors, issues, sanitized, specification };
  }
  return { ok: true, errors: [], issues, sanitized, specification };
}

// ─── Repair Agent ────────────────────────────────────────────────────────────
// Chiamato SOLO quando runValidator fallisce. Passa al modello FAST la
// specification corrente + l'errore preciso del validator, chiede una
// correzione mirata — mai una rigenerazione da zero (stesso spirito di
// REFACTOR_SYSTEM_PROMPT in app/api/creator/refactor/route.ts, qui applicato
// a un errore di validazione invece che a una richiesta utente).
const REPAIR_SYSTEM_PROMPT = `Sei il Repair Agent di ShardApps CreatorAI. Ricevi uno schema JSON che NON ha superato la validazione e l'elenco preciso degli errori.
Correggi SOLO ciò che serve per risolvere gli errori elencati, senza toccare nient'altro dello schema.
Rispondi SOLO con lo schema JSON COMPLETO corretto, stessa identica struttura di quello ricevuto (projectType, appName, sector, description, businessConfig, adminPanel, pages, actionButtons, ui, authConfig). Nessun testo prima o dopo, nessun blocco markdown.`;

export async function runRepair(
  input: { rawSchema: unknown; errors: string[]; context?: { userId?: string; tenantId?: string } },
  aiCall: AiCallFn = callAiRouter as unknown as AiCallFn
): Promise<unknown> {
  const { content } = await aiCall({
    task: 'app-repair',
    messages: [
      { role: 'system', content: REPAIR_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `SCHEMA ATTUALE:\n${JSON.stringify(input.rawSchema)}\n\nERRORI DI VALIDAZIONE DA CORREGGERE:\n${input.errors.map((e) => `- ${e}`).join('\n')}`,
      },
    ],
    context: input.context,
  });

  try {
    return extractJsonFromAiContent(content);
  } catch (err) {
    throw new PlannerError(`Repair: JSON non valido (${err instanceof Error ? err.message : 'errore sconosciuto'})`);
  }
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

export const MAX_REPAIR_RETRIES = 2;

export interface OrchestratorParams {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  appId?: string | null;
  userPrompt: string;
  projectType: ProjectType;
  lang: string;
  /** Generator REALE, iniettato dal chiamante (app/api/creator/generate/
   * route.ts) — mai duplicato qui. Riceve il prompt utente (eventualmente
   * arricchito col contesto del Planner) e ritorna lo schema JSON grezzo,
   * esattamente come callSiteSchemaGenerator oggi. */
  generate: (promptWithPlanContext: string) => Promise<unknown>;
  /** Hook opzionale per un post-processing specifico del chiamante sullo
   * schema grezzo PRIMA della validazione (es. il fix "gestionale senza
   * pages" già presente in generate/route.ts) — mai logica nuova qui. */
  postProcessRawSchema?: (raw: unknown) => unknown;
  /** Planner/Repair sono FAST — injectable per i test (mai rete reale). */
  plannerCall?: AiCallFn;
  repairCall?: AiCallFn;
  /** Se true, salta il Planner (facoltativo per il refactor — requisito 3;
   * l'orchestrator resta comunque riutilizzabile anche senza Planner). */
  skipPlanner?: boolean;
}

export interface OrchestratorResult {
  job: GenerationJobRow;
  status: GenerationJobStatusResult;
  schema?: SiteBlueprintJSON;
  specification?: AppSpecification;
  error?: string;
}
type GenerationJobStatusResult = 'ready' | 'failed';

export async function runGenerationOrchestrator(params: OrchestratorParams): Promise<OrchestratorResult> {
  const { supabase, tenantId, userId, appId, userPrompt, projectType, lang, generate, postProcessRawSchema } = params;

  let job = await createGenerationJob(supabase, {
    tenantId,
    appId: appId ?? null,
    createdBy: userId,
    userPrompt,
    context: { projectType, lang },
  });

  // ─── 1. Planner (facoltativo, mai bloccante) ────────────────────────────
  let plan: GenerationPlan | null = null;
  if (!params.skipPlanner) {
    try {
      plan = await runPlanner(
        { userPrompt, projectType, lang, context: { userId, tenantId } },
        params.plannerCall
      );
      job = await updateGenerationJob(supabase, job.id, { plan, current_step: 'planner:done' });
    } catch (err) {
      // Planner best-effort (requisito 3/7): un fallimento qui NON blocca la
      // generazione, prosegue senza piano — registrato in artifacts per
      // osservabilità, mai silenzioso.
      job = await updateGenerationJob(supabase, job.id, {
        artifacts: { ...job.artifacts, plannerError: err instanceof Error ? err.message : String(err) },
        current_step: 'planner:skipped',
      });
    }
  }

  // ─── 2/3. Generator + Validator/Repair ──────────────────────────────────
  // Da qui in poi ogni eccezione NON già gestita internamente (generate()
  // che fallisce — es. errore di rete/AI provider — o un errore imprevisto
  // di bookkeeping) è esattamente il caso per cui app/api/creator/generate/
  // route.ts ricade sulla strategia di generazione legacy (requisito Fase 5
  // punto 7). Quel fallback resta l'unico punto che decide/esegue la
  // strategia legacy — questo try/catch NON la duplica — ma "esplicito e
  // registrato nel job" richiede che il job stesso rifletta che è stato
  // usato un fallback, invece di restare silenziosamente bloccato in uno
  // stato intermedio (es. 'generating'): lo marchiamo failed+fallback_used
  // PRIMA di rilanciare l'errore originale invariato.
  try {
    // ─── 2. Generator (riusa la funzione iniettata, mai duplicata) ───────
    job = await updateGenerationJob(supabase, job.id, { status: 'generating', current_step: 'generator' });
    const promptWithContext = `${planToPromptContext(plan)}${userPrompt}`;
    let rawSchema: unknown = await generate(promptWithContext);
    if (postProcessRawSchema) rawSchema = postProcessRawSchema(rawSchema);
    // CreatorAI v2: correzione deterministica (mai una chiamata AI, mai
    // fallibile) di eventuali type di campo palesemente incoerenti con
    // dashboardCards richieste dal prompt — vedi coerceObviousNumericFieldTypes
    // (site-schema.ts). Applicata SEMPRE, prima della validazione: risolve i
    // casi ovvi senza consumare un ciclo di repair via AI.
    rawSchema = coerceObviousNumericFieldTypes(rawSchema);

    // ─── 3. Validator (+ Repair, max MAX_REPAIR_RETRIES tentativi) ───────
    job = await updateGenerationJob(supabase, job.id, { status: 'validating', current_step: 'validator' });
    let result = runValidator(rawSchema);
    let retryCount = 0;
    if (result.issues?.length) {
      job = await updateGenerationJob(supabase, job.id, {
        artifacts: { ...job.artifacts, validationIssues: result.issues },
      });
    }

    while (!result.ok && retryCount < MAX_REPAIR_RETRIES) {
      retryCount += 1;
      job = await updateGenerationJob(supabase, job.id, {
        status: 'repairing',
        current_step: `repair:${retryCount}`,
        retry_count: retryCount,
        artifacts: { ...job.artifacts, [`validationErrors_attempt${retryCount}`]: result.errors },
      });

      try {
        rawSchema = await runRepair({ rawSchema, errors: result.errors, context: { userId, tenantId } }, params.repairCall);
      } catch (err) {
        // Il Repair stesso non produce JSON valido: tentativo fallito, riprova
        // (se restano retry) o esce dal loop con l'errore del validator.
        job = await updateGenerationJob(supabase, job.id, {
          artifacts: { ...job.artifacts, [`repairError_attempt${retryCount}`]: err instanceof Error ? err.message : String(err) },
        });
        continue;
      }

      job = await updateGenerationJob(supabase, job.id, { status: 'validating', current_step: 'validator' });
      result = runValidator(rawSchema);
    }

    if (!result.ok) {
      const errorMessage = `Validazione fallita dopo ${retryCount} tentativi di repair: ${result.errors.join('; ')}`;
      job = await updateGenerationJob(supabase, job.id, {
        status: 'failed',
        current_step: 'failed',
        error: errorMessage,
        retry_count: retryCount,
      });
      return { job, status: 'failed', error: errorMessage };
    }

    job = await updateGenerationJob(supabase, job.id, {
      status: 'ready',
      current_step: 'ready',
      specification: result.specification,
      retry_count: retryCount,
    });

    return { job, status: 'ready', schema: result.sanitized, specification: result.specification };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await updateGenerationJob(supabase, job.id, {
        status: 'failed',
        current_step: 'fallback',
        error: message,
        fallback_used: true,
      });
    } catch {
      // Se anche l'update di bookkeeping fallisce (es. stesso errore di DB
      // che ha causato il fallimento originale), non deve mascherare
      // l'errore originale: si rilancia comunque sotto.
    }
    // Tagga l'id del job persistito sull'errore originale (stesso oggetto,
    // stesso `instanceof` per AiRouterError/AiRouterConfigError già gestiti
    // da route.ts — questo aggiunge solo un campo) così il chiamante può
    // tracciare quale riga di generation_jobs corrisponde a questo fallback,
    // senza dover cambiare il contratto try/catch esistente in route.ts.
    if (err && typeof err === 'object') {
      (err as { generationJobId?: string }).generationJobId = job.id;
    }
    throw err;
  }
}
