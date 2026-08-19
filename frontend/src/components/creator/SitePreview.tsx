'use client';

// ─── SitePreview ────────────────────────────────────────────────────────────
// Renderizza le pagine pubbliche di un SiteBlueprintJSON (site-schema.ts):
// nessun testo hardcoded, ogni contenuto arriva da businessConfig/pages/
// adminPanel. Le sezioni "form" (Prenota) restano sempre un mock statico
// (nessuna sottomissione reale da qui). Le sezioni "list" (Menu/Catalogo)
// mostrano dati di esempio generati dai field type dell'entità collegata
// SOLO quando non c'è ancora uno slug pubblico (editor/anteprima, l'app non è
// stata pubblicata) — una volta pubblicata (slug presente, /a/[slug]) i dati
// reali arrivano da GET /api/public/apps/[slug]/records (LiveListSection,
// vedi site-preview-utils.tsx), con lo stesso mock come placeholder
// ottimistico finché la rete non risponde. Le sezioni "gallery" restano
// invariate: le immagini vivono inline nello schema (section.images), non
// sono legate a un'entità.
//
// Fase 3 — Component Registry: il rendering per-tipo di sezione (i 9 case
// che prima vivevano qui dentro come switch(section.type)) è stato spostato
// in frontend/src/components/creator/sections/index.tsx, ciascuno registrato
// nel Component Registry (frontend/src/lib/creator/component-registry.ts).
// SectionRenderer sotto non sceglie più il componente con uno switch: lo
// recupera dal Registry in base a `section.type` — stesso identico
// comportamento visuale, un punto di estensione in più per le fasi
// successive. Import di "./sections" qui sotto è un side effect voluto: fa
// girare le 9 register() prima che qualunque sezione possa essere montata.

import { useMemo } from 'react';
import { Phone, MessageCircle, MapPin, Mail, Menu as MenuIcon } from 'lucide-react';
import type {
  SiteBlueprintJSON,
  SitePage,
  PageSection,
  ActionButton,
} from '@/src/lib/site-schema';
import { buildFallbackLandingSections } from '@/src/lib/site-schema';
import { sectionComponentRegistry } from '@/src/lib/creator/component-registry';
import { SectionFallback } from './sections';
import { hexToRgba, resolveActionHref } from './site-preview-utils';

// `actionIcon` resta qui: usata solo da StickyActionBar più sotto, nessun
// renderer di sezione ne ha bisogno (vedi site-preview-utils.tsx).
function actionIcon(type: ActionButton['type']) {
  switch (type) {
    case 'call': return <Phone size={16} />;
    case 'whatsapp': return <MessageCircle size={16} />;
    case 'map': return <MapPin size={16} />;
    case 'email': return <Mail size={16} />;
    default: return null;
  }
}

// ─── Sezioni ─────────────────────────────────────────────────────────────────
// Delega al Component Registry: `sectionComponentRegistry.get(section.type)`
// restituisce lo stesso componente che prima era un case dello switch. Un
// `type` senza entry registrata (non raggiungibile oggi con lo schema Zod
// chiuso sui 9 valori, ma comunque gestito in modo esplicito, vedi requisito
// Fase 3 "compatibilità legacy") usa SectionFallback — non fa mai crashare
// la pagina.

function SectionRenderer({
  section,
  schema,
  onNavigate,
  slug,
}: {
  section: PageSection;
  schema: SiteBlueprintJSON;
  onNavigate?: (slug: string) => void;
  /** Slug pubblico dell'app: presente solo su /a/[slug] (sito pubblicato),
   * assente in editor/anteprima. Attiva LiveListSection per le sezioni
   * "list" collegate a un'entità, vedi site-preview-utils.tsx. */
  slug?: string;
}) {
  // Reso come vero componente JSX (`<Renderer .../>`), non invocato come
  // funzione semplice: necessario perché React tratti ogni `type` come un
  // confine di componente a sé (regole degli hook per "list"/LiveListSection,
  // remount corretto quando lo stesso slot cambia tipo tra due render nello
  // stesso editor live) — vedi commento su ComponentRenderer in
  // component-registry.ts.
  //
  // react-hooks/static-components: falso positivo qui — la regola presume
  // che una variabile locale usata come tag JSX possa essere una closure
  // ricreata a ogni render (identità instabile, stato perso), ma
  // `sectionComponentRegistry.get()` restituisce sempre lo STESSO riferimento
  // stabile registrato una sola volta al caricamento del modulo
  // (sections/index.tsx), mai una funzione creata qui — esattamente il
  // pattern "registry di componenti" per cui il Registry esiste (Fase 3).
  const Renderer = sectionComponentRegistry.get(section.type) ?? SectionFallback;
  // eslint-disable-next-line react-hooks/static-components -- vedi nota sopra: riferimento stabile, non ricreato a ogni render.
  return <Renderer section={section} schema={schema} onNavigate={onNavigate} slug={slug} />;
}

// ─── Navigazione + pulsanti sticky ──────────────────────────────────────────

function SiteNav({ schema, activeSlug, onNavigate }: { schema: SiteBlueprintJSON; activeSlug: string; onNavigate: (slug: string) => void }) {
  const primary = schema.ui.primaryColor;
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white/95 px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-2">
        {schema.businessConfig.logoUrl ? (
          <img src={schema.businessConfig.logoUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: primary }}>
            {(schema.businessConfig.name || 'Z').charAt(0).toUpperCase()}
          </div>
        )}
        <span className="text-sm font-bold text-gray-900">{schema.businessConfig.name}</span>
      </div>
      <nav className="flex gap-1 overflow-x-auto">
        {schema.pages.map((p) => (
          <button
            key={p.slug}
            onClick={() => onNavigate(p.slug)}
            className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
            style={activeSlug === p.slug ? { backgroundColor: hexToRgba(primary, 0.12), color: primary } : { color: '#6b7280' }}
          >
            {p.label}
          </button>
        ))}
      </nav>
    </header>
  );
}

function StickyActionBar({ schema }: { schema: SiteBlueprintJSON }) {
  if (schema.actionButtons.length === 0) return null;
  return (
    <div className="sticky bottom-0 z-10 flex gap-2 border-t border-gray-100 bg-white/95 p-3 backdrop-blur">
      {schema.actionButtons.map((btn, i) => (
        <a
          key={i}
          href={resolveActionHref(btn, schema)}
          target={btn.type === 'map' || btn.type === 'whatsapp' ? '_blank' : undefined}
          rel="noreferrer"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5 text-xs font-semibold text-white shadow"
          style={{ backgroundColor: schema.ui.primaryColor }}
        >
          {actionIcon(btn.type)}
          {btn.label}
        </a>
      ))}
    </div>
  );
}

// ─── Componente principale ───────────────────────────────────────────────────
// Nessun frame/mock (niente bordo telefono, ombra esterna, max-width): questo
// è il motore di rendering reale del sito pubblico, usato sia in anteprima
// nell'editor (AppEditorView.tsx) sia sulla route pubblica /a/[slug]
// (page.tsx) — deve occupare il 100% di altezza/larghezza del contenitore in
// entrambi i contesti, altrimenti l'anteprima mente su come apparirà il sito.

export default function SitePreview({
  schema,
  activePageSlug,
  onNavigate,
  slug,
}: {
  schema: SiteBlueprintJSON;
  activePageSlug?: string;
  onNavigate?: (slug: string) => void;
  /** Slug pubblico dell'app: passato solo da /a/[slug] (sito pubblicato).
   * Assente nell'editor (AppEditorView) perché l'app non ha ancora uno slug
   * finché non viene pubblicata — in quel caso le sezioni "list" mostrano
   * sempre il mock, invariato. Vedi LiveListSection sopra. */
  slug?: string;
}) {
  const activePage: SitePage = useMemo(() => {
    return schema.pages.find((p) => p.slug === activePageSlug) || schema.pages[0];
  }, [schema.pages, activePageSlug]);

  // Rete di sicurezza SOLO per app già pubblicate prima del Quality Pass v1
  // (Fix #1) con "sections": [] già salvato in apps.config: sanitizeSiteBlueprint
  // ora riempie sempre le pagine vuote per le generazioni nuove/rigenerate,
  // ma non riscrive retroattivamente i blueprint già persistiti. Calcolata
  // qui, mai persistita: un refresh della pagina la ricalcola identica dagli
  // stessi dati (businessConfig/adminPanel.entities), zero stato nuovo da
  // gestire lato server.
  const displaySections: PageSection[] = useMemo(() => {
    if (activePage.sections.length > 0) return activePage.sections;
    return buildFallbackLandingSections(schema.businessConfig, schema.adminPanel.entities);
  }, [activePage.sections, schema.businessConfig, schema.adminPanel.entities]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-white">
      <SiteNav schema={schema} activeSlug={activePage.slug} onNavigate={(slug) => onNavigate?.(slug)} />
      <div className="flex-1 overflow-y-auto">
        {displaySections.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center text-gray-400">
            <MenuIcon size={28} />
            <p className="text-sm">Questa pagina non ha ancora sezioni.</p>
          </div>
        ) : (
          displaySections.map((section, i) => (
            <SectionRenderer key={i} section={section} schema={schema} onNavigate={onNavigate} slug={slug} />
          ))
        )}
      </div>
      <StickyActionBar schema={schema} />
    </div>
  );
}
