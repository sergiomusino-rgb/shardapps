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
// CreatorAI V3 (sezioni 10-11, "Business Understanding"/"Planning"): tre
// campi opzionali in più (relations/metrics/formulas), stesso principio
// "elenco di nomi/concetti, non i dettagli" già usato da mainEntities/pages/
// workflows/keyFeatures — MAI un secondo modello parallelo, solo un piano
// leggermente più ricco che il Generator riceve come contesto (vedi
// planToPromptContext sotto). `.default([])` mantiene compatibilità con
// piani già persistiti in generation_jobs prima di questa estensione (un
// piano vecchio senza questi campi resta valido, semplicemente con array
// vuoti) e con un Planner AI che non li produce (nessun campo obbligatorio
// nuovo, nessun repair scatenato da questo).
export const GenerationPlanSchema = z.object({
  projectType: z.string(),
  sector: z.string(),
  mainEntities: z.array(z.string()).default([]),
  pages: z.array(z.string()).default([]),
  workflows: z.array(z.string()).default([]),
  keyFeatures: z.array(z.string()).default([]),
  /** Relazioni principali attese fra le entità, in forma leggibile breve
   * (es. "enrollment -> member", "ordini -> clienti"), non uno schema. */
  relations: z.array(z.string()).default([]),
  /** KPI/metriche principali attese in dashboard, in forma leggibile breve
   * (es. "totale fatturato", "abbonamenti attivi"). */
  metrics: z.array(z.string()).default([]),
  /** Formule/dipendenze principali attese fra campi numerici, in forma
   * leggibile breve (es. "subtotale = quantita × prezzo_unitario"). */
  formulas: z.array(z.string()).default([]),
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
  "keyFeatures": ["caratteristica principale 1", "caratteristica principale 2"],
  "relations": ["breve elenco di relazioni fra entità attese, es. 'ordine -> cliente', 'iscrizione -> corso'"],
  "metrics": ["KPI/metriche principali attese in dashboard, es. 'fatturato totale', 'ordini aperti'"],
  "formulas": ["eventuali formule/dipendenze fra campi numerici attese, es. 'totale = quantita × prezzo_unitario'"]
}
Non generare campi, tabelle dettagliate o pagine complete: solo l'elenco dei nomi/concetti principali. Se il dominio non ha workflow/stati/relazioni/formule espliciti, il relativo campo resta []. Non aggiungere testo prima o dopo il JSON.`;

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
    plan.relations?.length ? `Relazioni attese: ${plan.relations.join('; ')}` : '',
    plan.metrics?.length ? `KPI/metriche attese: ${plan.metrics.join('; ')}` : '',
    plan.formulas?.length ? `Formule/dipendenze attese: ${plan.formulas.join('; ')}` : '',
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

  // relation displayField (CreatorAI V3, sezione 7/8/12): resolveEntityRelations
  // (site-schema.ts) già AUTO-CORREGGE deterministicamente un displayField
  // richiesto che non esiste sull'entità target (sceglie un campo testo
  // reale, o "id" come ultima risorsa) — per questo il controllo qui opera
  // sullo schema RAW, PRIMA di quella correzione silenziosa (stesso motivo
  // per cui il controllo dashboardCards sotto usa rawSchema, non
  // `specification`): un displayField sbagliato nel blueprint richiesto dal
  // modello resta un segnale di qualità della generazione, anche quando
  // viene già corretto in automatico — mai bloccante (severity "warning",
  // il campo resta comunque un id di relazione valido).
  const rawEntities = (rawSchema as { adminPanel?: { entities?: unknown } } | null)?.adminPanel?.entities;
  if (Array.isArray(rawEntities)) {
    const rawEntityByName = new Map(
      (rawEntities as Array<Record<string, unknown>>)
        .filter((e) => typeof e?.name === 'string')
        .map((e) => [e.name as string, e])
    );
    for (const rawEntity of rawEntities as Array<Record<string, unknown>>) {
      const entityName = typeof rawEntity?.name === 'string' ? rawEntity.name : '?';
      const rawFields = Array.isArray(rawEntity?.fields) ? (rawEntity.fields as Array<Record<string, unknown>>) : [];
      for (const rawField of rawFields) {
        if (rawField?.type !== 'relation') continue;
        const targetName = (rawField.targetEntity ?? rawField.target) as string | undefined;
        const target = targetName ? rawEntityByName.get(targetName) : undefined;
        if (!target) continue; // già coperto da RELATION_TARGET_MISSING sopra
        const requestedDisplay = (rawField.displayField ?? rawField.targetLabel) as string | undefined;
        if (!requestedDisplay) continue; // nessuna richiesta esplicita, resolveEntityRelations sceglie da sé
        const targetFields = Array.isArray(target.fields) ? (target.fields as Array<Record<string, unknown>>) : [];
        const displayIsValid = targetFields.some((f) => f?.id === requestedDisplay && f?.type !== 'id');
        if (!displayIsValid) {
          issues.push({
            severity: 'warning',
            code: 'RELATION_DISPLAY_FIELD_MISSING',
            path: `adminPanel.entities.${entityName}.fields.${String(rawField.id ?? '?')}`,
            message: `Entità "${entityName}", campo "${String(rawField.id ?? '?')}": displayField "${requestedDisplay}" richiesto non esiste su "${targetName}" — corretto automaticamente con un campo di fallback, ma è un segnale di qualità del blueprint generato.`,
          });
        }
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, issues, sanitized, specification };
  }
  return { ok: true, errors: [], issues, sanitized, specification };
}

// ─── Classificazione degli issue (CreatorAI V3, sezione 13) ────────────────
// Il repair loop (invariato: max MAX_REPAIR_RETRIES tentativi, invocato SOLO
// quando result.ok è false, cioè quando esistono `errors`) è già per
// costruzione riservato ai soli difetti "strutturali" (riferimenti rotti fra
// entità/pagine/workflow — mai un'incoerenza opinabile o una scelta
// estetica). Questa classificazione NON cambia quella logica (nessun nuovo
// gate, nessun rischio di "riparare" un warning che prima non lo era) — è
// puramente osservativa (persistita in generation_jobs.artifacts), per
// distinguere a colpo d'occhio la NATURA di un issue quando si analizza una
// generazione fallita o un warning, come richiesto dalla sezione 13
// ("classifica: structural, semantic, data, relation, UI").
export type IssueCategory = 'structural' | 'semantic' | 'data' | 'relation' | 'UI';

const ISSUE_CATEGORY_BY_CODE: Record<string, IssueCategory> = {
  SCHEMA_UNRECOVERABLE: 'structural',
  SPEC_SCHEMA_INVALID: 'structural',
  SECTION_ENTITY_MISSING: 'structural',
  ACTION_TARGET_STATE_INVALID: 'semantic',
  RELATION_TARGET_MISSING: 'relation',
  RELATION_DISPLAY_FIELD_MISSING: 'relation',
  WORKFLOW_TRIGGER_ENTITY_MISSING: 'relation',
  WORKFLOW_ACTION_TARGET_MISSING: 'relation',
  DASHBOARD_CARD_TABLE_MISSING: 'data',
  DASHBOARD_FIELD_TYPE_MISMATCH: 'data',
};

/** Classifica un ValidationIssue nella sua natura (sezione 13) — codice non
 * riconosciuto (es. un futuro nuovo check) ricade su 'structural', la
 * categoria più cautelativa (mai sottostimare la gravità di un issue
 * sconosciuto). */
export function classifyIssueCategory(issue: ValidationIssue): IssueCategory {
  return ISSUE_CATEGORY_BY_CODE[issue.code] ?? 'structural';
}

// ─── Self-Evaluation (CreatorAI V3, sezione 14) ────────────────────────────
// Verifica FINALE, leggera (nessun NLP), rispetto alla richiesta originale
// dell'utente — puramente osservativa (mai bloccante, mai un motivo di
// repair: la sezione 14 stessa richiede "non bloccare generazioni valide per
// interpretazioni speculative" — un parsing euristico del prompt non è mai
// abbastanza affidabile da giustificare un repair automatico che potrebbe
// INVENTARE un'entità/relazione/KPI mai realmente richiesta, lo stesso
// principio "mai un'invenzione" già seguito da mockDataGenerator.ts per il
// fallback dei campi non riconosciuti). Persistita in
// generation_jobs.artifacts per osservabilità, non usata per decidere
// ok/fail della generazione.
export interface SelfEvaluationResult {
  /** 0..1 — quota di segnali rilevati nel prompt che risultano soddisfatti
   * nella specification generata. 1 quando il prompt non contiene alcun
   * segnale verificabile (nessuna evidenza di omissione, non un giudizio
   * di qualità assoluto). */
  score: number;
  satisfied: string[];
  missing: string[];
  warnings: string[];
}

const RELATION_HINTS = /relazion|collegat|associat|\blink\b|\brelation/i;
const WORKFLOW_HINTS = /\bstato\b|\bstati\b|\bflusso\b|\bworkflow\b|\bstage\b|\bstatus\b/i;
const KPI_HINTS = /dashboard|\bkpi\b|statistic|\breport\b|fatturat|ricav|entrat|\btotale\b/i;
const FORMULA_HINTS = /calcola|formula|moltiplic|totale\s*=|×|\bsubtotal/i;

/**
 * Verifica minima "il richiesto è presente?" — sezione 14: entità
 * principali, relazioni, workflow, KPI quando calcolabili, formule (solo
 * come warning informativo, mai come "missing": non abbastanza affidabile
 * per verificarle sullo schema persistito, che non porta le formule stesse —
 * vedi mockDataGenerator.ts::FormulaContext, deliberatamente interno/non
 * persistito, sezione 9 della spec V3).
 */
export function evaluateGenerationAgainstPrompt(userPrompt: string, specification: AppSpecification): SelfEvaluationResult {
  const satisfied: string[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];

  if (specification.entities.length > 0) {
    satisfied.push(`${specification.entities.length} entità generate`);
  } else {
    missing.push('nessuna entità generata');
  }

  const hasRelationField = specification.entities.some((e) => e.fields.some((f) => f.type === 'relation'));
  if (RELATION_HINTS.test(userPrompt)) {
    if (hasRelationField) satisfied.push('relazioni tra entità presenti, come suggerito dalla richiesta');
    else missing.push('la richiesta suggerisce relazioni tra entità ma nessun campo relation è presente nello schema generato');
  }

  const hasStateField = specification.entities.some((e) => e.fields.some((f) => f.type === 'state'));
  if (WORKFLOW_HINTS.test(userPrompt)) {
    if (hasStateField) satisfied.push('workflow/stati presenti, come suggerito dalla richiesta');
    else missing.push('la richiesta suggerisce un workflow/stato ma nessun campo state è presente nello schema generato');
  }

  const hasDashboard = Boolean(specification.dashboard?.cards?.length);
  if (KPI_HINTS.test(userPrompt)) {
    if (hasDashboard) satisfied.push('KPI/dashboard presenti, come suggerito dalla richiesta');
    else missing.push('la richiesta suggerisce KPI/dashboard ma nessuna dashboardCard è presente nello schema generato');
  }

  if (FORMULA_HINTS.test(userPrompt)) {
    const hasMultipleNumericOnSameEntity = specification.entities.some(
      (e) => e.fields.filter((f) => f.type === 'number' || f.type === 'currency').length >= 2
    );
    if (hasMultipleNumericOnSameEntity) {
      satisfied.push('più campi numerici sulla stessa entità, coerente con una formula/calcolo richiesto');
    } else {
      warnings.push('la richiesta suggerisce una formula/calcolo ma non è stato possibile verificarlo automaticamente sullo schema (non bloccante)');
    }
  }

  const total = satisfied.length + missing.length;
  const score = total === 0 ? 1 : satisfied.length / total;
  return { score, satisfied, missing, warnings };
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
  const { supabase, tenantId, userId, appId, userPrompt, projectType, lang } = params;

  const job = await createGenerationJob(supabase, {
    tenantId,
    appId: appId ?? null,
    createdBy: userId,
    userPrompt,
    context: { projectType, lang },
  });

  return runGenerationPipeline(params, job);
}

/**
 * Tutto ciò che avviene DOPO la creazione del job: Planner -> Generator ->
 * Validator/Repair -> ready/failed. Estratta da runGenerationOrchestrator
 * (P0-1, root-cause report "async generation / client-server lifecycle
 * mismatch") perché generate/route.ts possa creare il job SINCRONAMENTE
 * (risposta HTTP rapida con jobId) e proseguire la pipeline dentro
 * `after()` (next/server) senza duplicare questa logica. Il comportamento
 * di runGenerationOrchestrator stesso resta IDENTICO — usato invariato da
 * creator/refactor/route.ts e da ogni test esistente che lo chiama
 * direttamente.
 */
export async function runGenerationPipeline(
  params: OrchestratorParams,
  initialJob: GenerationJobRow
): Promise<OrchestratorResult> {
  const { supabase, tenantId, userId, userPrompt, projectType, lang, generate, postProcessRawSchema } = params;
  let job = initialJob;

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

    // ─── Self-Evaluation (CreatorAI V3, sezione 14) ───────────────────────
    // Best-effort, mai bloccante (stesso principio del Planner sopra): un
    // fallimento qui (es. userPrompt vuoto/inatteso) non deve mai impedire
    // di restituire una generazione altrimenti valida. Puramente osservativa
    // — persistita in artifacts, non usata per decidere ok/fail.
    let selfEvaluation: SelfEvaluationResult | undefined;
    try {
      if (result.specification) selfEvaluation = evaluateGenerationAgainstPrompt(userPrompt, result.specification);
    } catch {
      // Nessuna azione: self-evaluation resta assente, la generazione
      // procede comunque (stesso spirito del Planner best-effort).
    }

    job = await updateGenerationJob(supabase, job.id, {
      status: 'ready',
      current_step: 'ready',
      specification: result.specification,
      retry_count: retryCount,
      artifacts: { ...job.artifacts, ...(selfEvaluation ? { selfEvaluation } : {}) },
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
