// ─── Component Registry (CreatorAI Engine 2.0 — Fase 3: Generic UI Engine) ──
// Sostituisce lo switch(type) monolitico che viveva dentro SectionRenderer
// (frontend/src/components/creator/SitePreview.tsx) con un registro
// type -> renderer esplicito, estensibile e tipizzato.
//
// Architettura target di questa fase:
//   PageSectionSchema / AppSpecification
//         ↓
//   Component Registry (questo file)
//         ↓
//   renderer[type]
//         ↓
//   componente React sicuro
//
// Cosa NON è questo file:
// - NON genera codice: registra riferimenti a componenti React già scritti a
//   mano (vedi frontend/src/components/creator/sections/index.tsx). L'AI
//   produce solo una PageSection (dati/config); il Registry decide quale
//   componente esistente e sicuro renderizzare per quel `type` — mai
//   eval/new Function/dangerouslySetInnerHTML.
// - NON introduce nuovi tipi di sezione: i 9 valori di PageSectionType
//   (site-schema.ts) restano l'unico vocabolario effettivamente raggiungibile
//   dallo schema in questa fase. La classe sottostante è generica apposta
//   (`type: string`, non vincolata a PageSectionType) così un domani un tipo
//   futuro (table/kanban/calendar/chart/dashboard/tabs/stats) potrà
//   registrarsi senza modificare questo file — collegarlo allo schema Zod
//   (che oggi è una discriminated union CHIUSA sui 9 valori, vedi
//   PageSectionSchema in site-schema.ts) resta un passo successivo,
//   volutamente fuori dal perimetro della Fase 3 (vedi report).
//
// La classe è generica (ComponentRegistry<TProps>) e non ha alcuna
// dipendenza da React/site-schema: riutilizzabile in futuro per altri
// registri (es. un domani un registry di widget dashboard) senza doverla
// riscrivere.

// Ritorna sempre ReactNode (mai `unknown`): il valore registrato deve poter
// essere usato come vero componente JSX (`<Renderer {...props} />`), non
// invocato come funzione semplice — invocarlo come funzione semplice
// "appiattirebbe" il suo confine di componente nell'albero di React (nessun
// Fiber proprio), rompendo silenziosamente le regole degli hook per
// qualunque renderer registrato che ne usasse uno internamente (es. "list",
// che compone LiveListSection) e impedendo a React di riconoscere il cambio
// di `type` tra due render dello stesso slot (stesso indice nell'array
// `sections`) come "componente diverso" da smontare/rimontare — scenario
// reale nell'editor live (AppEditorView), dove lo schema cambia a runtime.
export type ComponentRenderer<TProps> = (props: TProps) => ReactNode;

export interface RegisterOptions {
  /**
   * Consente di sovrascrivere deliberatamente un `type` già registrato.
   * Default false: una register() duplicata sullo stesso `type` è quasi
   * sempre un bug (due componenti che si contendono lo stesso nome), non
   * un'operazione voluta — vedi requisito Fase 3 "impedire collisioni
   * accidentali tra componenti registrati".
   */
  allowOverride?: boolean;
}

/**
 * Registro generico `type` (stringa) -> renderer. Ogni istanza è isolata
 * (nessuno stato globale condiviso implicito): chi vuole un registro
 * "di sezione" tipizzato per PageSection ne crea una propria istanza — vedi
 * `sectionComponentRegistry` più sotto.
 */
export class ComponentRegistry<TProps> {
  private readonly renderers = new Map<string, ComponentRenderer<TProps>>();

  /**
   * Registra un renderer per `type`. Lancia se `type` è vuoto o se esiste
   * già una entry per lo stesso `type` (collisione accidentale) — a meno di
   * `{ allowOverride: true }`, per i pochi casi in cui una sostituzione
   * deliberata ha senso (es. test).
   */
  register(type: string, renderer: ComponentRenderer<TProps>, options: RegisterOptions = {}): void {
    if (!type) {
      throw new Error('ComponentRegistry.register: "type" non può essere vuoto');
    }
    if (this.renderers.has(type) && !options.allowOverride) {
      throw new Error(
        `ComponentRegistry: il componente "${type}" è già registrato (collisione). ` +
        'Passa { allowOverride: true } se la sostituzione è intenzionale.'
      );
    }
    this.renderers.set(type, renderer);
  }

  /** Il renderer registrato per `type`, o `undefined` se nessuno lo copre. */
  get(type: string): ComponentRenderer<TProps> | undefined {
    return this.renderers.get(type);
  }

  /** true se `type` ha un renderer registrato. */
  has(type: string): boolean {
    return this.renderers.has(type);
  }

  /** Elenco dei `type` attualmente registrati (ordine di registrazione). */
  list(): string[] {
    return [...this.renderers.keys()];
  }
}

// ─── Registro di sezione (PageSection, motore Sito/PWA Creator v2) ─────────
// Props condivise da ogni renderer di sezione: stessa identica forma già
// ricevuta oggi da SectionRenderer in SitePreview.tsx (nessun campo nuovo,
// nessun campo rimosso) — mantiene la compatibilità totale richiesta dalla
// Fase 3. `TSection` di default è l'intera union `PageSection`; i singoli
// componenti registrati (sections/index.tsx) la narrowano al proprio ramo
// tramite `SectionRendererPropsFor<'hero'>` ecc.
import type { ReactNode } from 'react';
import type { PageSection, SiteBlueprintJSON, PageSectionType } from '@/src/lib/site-schema';

export interface SectionRendererProps<TSection = PageSection> {
  section: TSection;
  schema: SiteBlueprintJSON;
  onNavigate?: (slug: string) => void;
  /** Slug pubblico dell'app: presente solo su /a/[slug] (sito pubblicato),
   * assente in editor/anteprima — stesso contratto di SitePreview.tsx. */
  slug?: string;
}

/** Props di un renderer per un ramo specifico della union PageSection. */
export type SectionRendererPropsFor<T extends PageSectionType> =
  SectionRendererProps<Extract<PageSection, { type: T }>>;

export type SectionComponent = ComponentRenderer<SectionRendererProps>;

/**
 * Istanza condivisa usata da SitePreview.tsx. Popolata con le 9 entry
 * predefinite dall'import (side-effect) di
 * frontend/src/components/creator/sections/index.tsx — questo file resta
 * volutamente privo di JSX/React runtime, per poter essere eseguito e
 * testato anche direttamente con `node --test` (vedi component-registry.test.ts).
 */
export const sectionComponentRegistry = new ComponentRegistry<SectionRendererProps>();
