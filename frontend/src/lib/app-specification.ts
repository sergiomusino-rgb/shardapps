// ─── App Specification (CreatorAI Engine 2.0 — Fase 0: Architecture Foundation) ────
// Contratto tipizzato centrale che unifica CONCETTUALMENTE i due modelli
// esistenti — BlueprintJSON (blueprint-schema.ts, motore v1 "gestionale",
// sector-agnostico) e SiteBlueprintJSON (site-schema.ts, motore v2
// "sito/PWA/e-commerce", 3 projectType fissi) — senza sostituirli e senza
// alterarne il comportamento.
//
// Questo modulo:
// - NON è collegato a nessuna route (generate/refactor/publish/apps) in
//   questa fase: nessuna riga di codice qui è ancora eseguita in produzione.
// - NON ri-deriva la validazione semantica già presente in site-schema.ts
//   (resolveEntityRelations/resolveEntityStatesAndActions) né in
//   blueprint-schema.ts (ensureCoreSystemTables e affini): un AppSpecification
//   si costruisce SEMPRE a partire da un BlueprintJSON/SiteBlueprintJSON già
//   passato dal proprio sanitizer — questo modulo assume l'input valido, non
//   lo rivalida da zero.
// - Espone solo: lo schema Zod del contratto (AppSpecificationSchema), i tipi
//   derivati, due adattatori puri (toAppSpecificationFromBlueprint,
//   toAppSpecificationFromSiteBlueprint) e due proiezioni inverse MINIME
//   (toBlueprintCompatibleTables, toAdminPanelCompatibleEntities) usate solo
//   per verificare che le entità restino rappresentabili nella forma già
//   consumata dai renderer esistenti (creator-server.ts::toViewerTables per
//   v1, adaptAdminEntitiesToTables in app/a/[slug]/app/page.tsx per v2) —
//   nessuna delle due funzioni è importata da quei file in questa fase.
//
// ─── Nota tecnica sulle scelte di import (verificata empiricamente) ─────────
// blueprint-schema.ts non ha import relativi interni: le sue esportazioni
// (FieldSchema, DashboardCardSchema, ...) sono quindi importabili qui come
// VALORI runtime senza alcun problema, con un import RELATIVO CON ESTENSIONE
// esplicita (`./blueprint-schema.ts`) — necessario perché questo file, a
// differenza delle route Next.js, deve poter essere eseguito anche DIRETTAMENTE
// da `node --test` (Node 24 esegue TypeScript nativamente via type-stripping,
// ma il suo resolver ESM — a differenza del bundler di Next.js,
// moduleResolution:"bundler" — non risolve automaticamente uno specifier
// relativo privo di estensione su un file .ts; verificato con un import
// diretto di prova, che fallisce con ERR_MODULE_NOT_FOUND). Per questo motivo
// qui l'estensione è esplicita, e tsconfig.json abilita
// `allowImportingTsExtensions` (richiede noEmit:true, già presente nel
// progetto) — unica modifica a un file condiviso di questa fase, puramente
// additiva: nessun import esistente nel resto del progetto viene toccato o
// smette di essere valido.
//
// site-schema.ts, al contrario, importa `./blueprint-schema` SENZA estensione
// (stile idiomatico per moduleResolution:"bundler", corretto per Next.js) —
// un import di VALORE da site-schema.ts qui romperebbe quindi l'esecuzione
// isolata dei test (Node tenterebbe di risolvere anche l'import interno di
// site-schema.ts, fallendo). Le sue esportazioni sono perciò riusate qui SOLO
// come TIPI (`import type`, azzerati a runtime da TypeScript/Node: nessuna
// risoluzione di modulo viene mai tentata per uno specifier type-only) — mai
// come valori Zod. Conseguenza esplicita, documentata anche nel report di
// Fase 0: per i campi che derivano dal motore v2 (pages, businessConfig,
// actionButtons, authConfig, entity.actions) AppSpecificationSchema fa solo
// una validazione di FORMA (oggetto/array presente e ben formato), non
// ri-implementa le regole di business già corrette in site-schema.ts — quelle
// restano l'unica fonte di verità, da chiamare sempre PRIMA di costruire un
// AppSpecification a partire da input non fidato (es. output grezzo di un
// modello AI).

import { z } from 'zod';
import {
  FieldSchema,
  DashboardCardSchema,
  type Field,
  type Table,
  type DashboardCard,
  type BlueprintJSON,
} from './blueprint-schema.ts';
import type {
  SiteBlueprintJSON,
  BusinessConfig,
  AdminEntity,
  EntityAction,
  SitePage,
  ActionButton,
  AuthConfig,
  Workflow,
} from './site-schema';

// ─── projectType esteso ──────────────────────────────────────────────────────
// I 3 valori del motore v2 (invariati) + 'gestionale': rappresenta il motore
// v1 (blueprint-engine.ts, generazione sector-agnostica) come 4° tipo di
// progetto dello STESSO contratto, invece che come prodotto separato — vedi
// audit architetturale, Sezione 6 ("V1 ENGINE ANALYSIS"). Il valore è
// supportato dal contratto ma NON ancora selezionabile da ProjectWizard.tsx
// né generato da alcuna route: collegarlo è esplicitamente fuori dal
// perimetro di questa fase.
export const AppProjectTypeSchema = z.enum(['landing', 'webapp-pwa', 'ecommerce', 'gestionale']);
export type AppProjectType = z.infer<typeof AppProjectTypeSchema>;

// ─── Validazione di forma per i concetti solo-v2 ────────────────────────────
// z.custom<T> lega il tipo TypeScript reale (import type da site-schema.ts,
// zero duplicazione della definizione) a un controllo runtime
// DELIBERATAMENTE leggero (il valore è un oggetto/array con la forma minima
// attesa) — la validazione approfondita (relazioni risolte, transizioni di
// stato valide, displayField reale...) resta di competenza esclusiva di
// site-schema.ts::sanitizeSiteBlueprint, per esplicita indicazione del
// perimetro di Fase 0 ("NON riscrivere resolveEntityRelations/
// resolveEntityStatesAndActions").
const businessConfigShape = z.custom<BusinessConfig>(
  (v) => typeof v === 'object' && v !== null,
  { message: 'businessConfig deve essere un oggetto' },
);
const sitePageShape = z.custom<SitePage>(
  (v) => typeof v === 'object' && v !== null && 'slug' in v && 'sections' in v && Array.isArray((v as { sections: unknown }).sections),
  { message: 'ogni pagina deve avere slug e sections (array)' },
);
const actionButtonShape = z.custom<ActionButton>(
  (v) => typeof v === 'object' && v !== null && 'type' in v,
  { message: 'ogni actionButton deve avere un type' },
);
const authConfigShape = z.custom<AuthConfig>(
  (v) => typeof v === 'object' && v !== null && 'enabled' in v,
  { message: 'authConfig deve avere il campo enabled' },
);
const entityActionShape = z.custom<EntityAction>(
  (v) => typeof v === 'object' && v !== null && 'id' in v && 'type' in v,
  { message: 'ogni action deve avere id e type' },
);
// Fase 4 (Logic/Workflow Engine): stesso principio, forma minima (trigger +
// almeno un'azione) — la validazione approfondita (trigger/azioni
// riconosciuti, condizioni ben formate) resta di competenza esclusiva di
// site-schema.ts::WorkflowSchema / backend/lib/workflow-model.js.
const workflowShape = z.custom<Workflow>(
  (v) => typeof v === 'object' && v !== null && 'trigger' in v && 'actions' in v && Array.isArray((v as { actions: unknown }).actions),
  { message: 'ogni workflow deve avere trigger e actions (array)' },
);

// ─── entities/fields — nucleo condiviso v1+v2 ───────────────────────────────
// Riusa FieldSchema COSÌ COM'È (import di valore, mai ridefinito): stessi
// tipi di campo, stessa normalizzazione, stesso supporto a relation/state già
// validati da blueprint-schema.ts — nessuna duplicazione. `actions` è
// opzionale (assente/[] per le entità che arrivano dal motore v1, che non ha
// mai avuto azioni sulle tabelle).
export const EntitySchema = z.object({
  name: z.string(),
  label: z.string(),
  labelPlural: z.string(),
  icon: z.string().optional().default(''),
  fields: z.array(FieldSchema).min(1).max(50),
  actions: z.array(entityActionShape).max(20).optional().default([]),
});
export type Entity = z.infer<typeof EntitySchema>;

// ─── branding / navigation / dashboard — concetti solo-v1, mai fabbricati per v2 ─
// v1 ha un `logo` top-level e un `ui.sidebar`/`ui.dashboardCards` che il
// motore v2 non ha mai avuto (la navigazione di v2 è già implicita
// nell'ordine di `pages[]`, e non esiste un concetto di KPI dashboard).
// Questi tre blocchi restano `undefined` per un AppSpecification derivato da
// SiteBlueprintJSON — mai popolati con dati inventati, per rispettare il
// requisito "lossless" senza introdurre falsi positivi nell'altra direzione.
export const AppBrandingSchema = z.object({
  logoUrl: z.string().optional().default(''),
});
export type AppBranding = z.infer<typeof AppBrandingSchema>;

export const AppNavigationSchema = z.object({
  /** Ordine delle entità in sidebar (da BlueprintJSON.ui.sidebar, motore v1). */
  order: z.array(z.string()),
});
export type AppNavigation = z.infer<typeof AppNavigationSchema>;

export const AppDashboardSchema = z.object({
  /** KPI dashboard (da BlueprintJSON.ui.dashboardCards, motore v1). Riusa
   * DashboardCardSchema di blueprint-schema.ts COSÌ COM'È (import di valore,
   * sicuro: quel file non ha import relativi interni). */
  cards: z.array(DashboardCardSchema),
});
export type AppDashboard = z.infer<typeof AppDashboardSchema>;

// ─── ui — fusione dei due UIConfig esistenti (v1: primaryColor/sidebar/cards
// separati sopra; v2: primaryColor/secondaryColor/font) ─────────────────────
export const AppUIConfigSchema = z.object({
  primaryColor: z.string(),
  secondaryColor: z.string().optional(),
  font: z.string().optional(),
});
export type AppUIConfig = z.infer<typeof AppUIConfigSchema>;

// ─── Il contratto centrale ───────────────────────────────────────────────────
export const AppSpecificationSchema = z.object({
  // application metadata
  appName: z.string(),
  sector: z.string(),
  description: z.string().optional().default(''),
  projectType: AppProjectTypeSchema,

  // branding/UI
  branding: AppBrandingSchema.optional(),
  ui: AppUIConfigSchema,

  // database/entità — nucleo condiviso, mai vuoto di default: sia v1 sia v2
  // richiedono almeno un'entità per essere un'app reale (min(1) enforced dal
  // sanitizer sorgente, non ri-derivato qui — un array vuoto è comunque
  // strutturalmente valido per AppSpecification stessa, che non re-impone
  // vincoli di business già imposti a monte).
  entities: z.array(EntitySchema).default([]),

  // superficie pubblica (motore v2) — OPZIONALE: un progetto "gestionale"
  // (motore v1) non ha pagine pubbliche, e non deve essere forzato ad
  // averne. Vedi requisito esplicito "pages deve essere opzionale" del piano.
  pages: z.array(sitePageShape).optional().default([]),
  actionButtons: z.array(actionButtonShape).optional().default([]),

  // dati anagrafici attività + auth multi-utente (motore v2, opzionali)
  businessConfig: businessConfigShape.optional(),
  authConfig: authConfigShape.optional(),

  // concetti solo-v1 (opzionali, mai fabbricati per un AppSpecification v2)
  navigation: AppNavigationSchema.optional(),
  dashboard: AppDashboardSchema.optional(),

  // Fase 4 (Logic/Workflow Engine): opzionale, default [] — un'app senza
  // workflows (tutte quelle esistenti prima di questa fase) resta identica.
  workflows: z.array(workflowShape).optional().default([]),
});
export type AppSpecification = z.infer<typeof AppSpecificationSchema>;

// ══════════════════════════════════════════════════════════════════════════
// ADATTATORI — funzioni pure: nessun I/O, nessuna chiamata AI, nessuna
// scrittura DB, nessuna generazione di slug, nessuna pubblicazione, nessuna
// mutazione dell'input (ogni oggetto/array annidato viene copiato).
// ══════════════════════════════════════════════════════════════════════════

function copyField(f: Field): Field {
  return { ...f };
}

function tableToEntity(table: Table): Entity {
  return {
    name: table.name,
    label: table.label,
    labelPlural: table.labelPlural,
    icon: table.icon ?? '',
    fields: table.fields.map(copyField),
    actions: [],
  };
}

function adminEntityToEntity(entity: AdminEntity): Entity {
  return {
    name: entity.name,
    label: entity.label,
    labelPlural: entity.labelPlural,
    icon: entity.icon ?? '',
    fields: entity.fields.map(copyField),
    actions: entity.actions.map((a) => ({ ...a })),
  };
}

/**
 * BlueprintJSON (motore v1, "gestionale") -> AppSpecification.
 * Assume `source` già passato da blueprint-schema.ts::sanitizeBlueprint
 * (incluso ensureCoreSystemTables): non ri-valida, solo trasforma.
 */
export function toAppSpecificationFromBlueprint(source: BlueprintJSON): AppSpecification {
  return {
    appName: source.appName,
    sector: source.sector,
    description: source.description ?? '',
    projectType: 'gestionale',
    branding: source.logo ? { logoUrl: source.logo } : undefined,
    ui: {
      primaryColor: source.ui.primaryColor,
      secondaryColor: undefined,
      font: undefined,
    },
    entities: source.schema.tables.map(tableToEntity),
    pages: [],
    actionButtons: [],
    businessConfig: undefined,
    authConfig: undefined,
    navigation: source.ui.sidebar.length > 0 ? { order: [...source.ui.sidebar] } : undefined,
    dashboard: source.ui.dashboardCards.length > 0
      ? { cards: source.ui.dashboardCards.map((c: DashboardCard) => ({ ...c })) }
      : undefined,
    // Fase 4: BlueprintJSON (v1) non ha mai avuto un concetto di workflow —
    // [] esplicito, mai fabbricato.
    workflows: [],
  };
}

/**
 * SiteBlueprintJSON (motore v2, "sito/PWA/e-commerce") -> AppSpecification.
 * Assume `source` già passato da site-schema.ts::sanitizeSiteBlueprint
 * (relazioni/stati già risolti da resolveEntityRelations/
 * resolveEntityStatesAndActions): non ri-valida, solo trasforma.
 */
export function toAppSpecificationFromSiteBlueprint(source: SiteBlueprintJSON): AppSpecification {
  return {
    appName: source.appName,
    sector: source.sector,
    description: source.description ?? '',
    projectType: source.projectType,
    branding: source.businessConfig.logoUrl ? { logoUrl: source.businessConfig.logoUrl } : undefined,
    ui: {
      primaryColor: source.ui.primaryColor,
      secondaryColor: source.ui.secondaryColor,
      font: source.ui.font,
    },
    entities: source.adminPanel.entities.map(adminEntityToEntity),
    pages: source.pages.map((p) => ({ ...p, sections: p.sections.map((s) => ({ ...s })) })),
    actionButtons: source.actionButtons.map((b) => ({ ...b })),
    businessConfig: { ...source.businessConfig, openingHours: source.businessConfig.openingHours.map((h) => ({ ...h })) },
    authConfig: { ...source.authConfig, supportedRoles: [...source.authConfig.supportedRoles] },
    navigation: undefined, // v2 non ha questo concetto: mai fabbricato
    dashboard: undefined,  // v2 non ha questo concetto: mai fabbricato
    // Fase 4: copia diretta (shallow, come businessConfig/authConfig sopra) —
    // il workflow shape è già stato validato a monte da sanitizeSiteBlueprint.
    workflows: source.workflows.map((w) => ({ ...w })),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// PROIEZIONI INVERSE MINIME — solo per verificare in test che le entità di un
// AppSpecification restino rappresentabili nella forma già consumata dai
// renderer esistenti. NON importate da nessuna route/componente reale in
// questa fase (creator-server.ts::toViewerTables e
// adaptAdminEntitiesToTables in app/a/[slug]/app/page.tsx restano invariati e
// non richiamano queste funzioni).
// ══════════════════════════════════════════════════════════════════════════

/** Forma compatibile con Table[] (blueprint-schema.ts, motore v1). */
export function toBlueprintCompatibleTables(spec: AppSpecification): Table[] {
  return spec.entities.map((e) => ({
    name: e.name,
    label: e.label,
    labelPlural: e.labelPlural,
    icon: e.icon ?? '',
    fields: e.fields.map(copyField),
  }));
}

/** Forma compatibile con AdminEntity[] (site-schema.ts, motore v2). */
export function toAdminPanelCompatibleEntities(spec: AppSpecification): AdminEntity[] {
  return spec.entities.map((e) => ({
    name: e.name,
    label: e.label,
    labelPlural: e.labelPlural,
    icon: e.icon ?? '',
    fields: e.fields.map(copyField),
    actions: (e.actions ?? []).map((a) => ({ ...a })),
  })) as AdminEntity[];
}
