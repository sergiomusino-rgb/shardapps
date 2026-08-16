'use client';

// ─── Sezioni registrate nel Component Registry (Fase 3 — Generic UI Engine) ─
// I 9 renderer qui sotto sono lo stesso identico JSX/logica che viveva prima
// dentro lo switch(section.type) di SectionRenderer in SitePreview.tsx — solo
// spostati, uno per branch, e registrati nel Registry invece che scelti da
// uno switch. Nessun comportamento visuale cambiato: props/config, comandi
// di sanitizzazione (hideOnImageError, resolveCtaTarget, mock/LiveListSection
// per "list") e limiti restano identici.
//
// Import di questo modulo (da SitePreview.tsx) = side effect: le 9
// `sectionComponentRegistry.register(...)` sotto girano una sola volta, alla
// prima valutazione del modulo (semantica standard ES module), PRIMA che
// SitePreview possa montare una sezione — nessuna race condition.
//
// Perché in un file solo (non un file per sezione): stessa dimensione dello
// switch originale, stessa navigabilità (si legge dall'alto in basso come
// prima), diff minimo e facilmente confrontabile 1:1 col codice che
// sostituisce — frazionare in 9 file avrebbe sparpagliato senza un beneficio
// concreto in questa fase (nessun requisito lo chiede). Vedi report Fase 3.

import { MapPin, Phone, Mail, Star } from 'lucide-react';
import type { Field } from '@/src/lib/blueprint-schema';
import { KNOWN_SECTION_TYPES } from '@/src/lib/site-schema';
import {
  sectionComponentRegistry,
  type SectionRendererPropsFor,
  type SectionComponent,
} from '@/src/lib/creator/component-registry';
import {
  hideOnImageError,
  hexToRgba,
  mockEntityItems,
  findEntity,
  resolveCtaTarget,
  LiveListSection,
} from '../site-preview-utils';

// ─── hero ────────────────────────────────────────────────────────────────────
function HeroSection({ section, schema, onNavigate }: SectionRendererPropsFor<'hero'>) {
  const primary = schema.ui.primaryColor;
  return (
    <section
      className="relative flex flex-col items-center justify-center gap-4 px-6 py-16 text-center"
      style={{
        backgroundImage: section.imageUrl ? `linear-gradient(${hexToRgba('#000000', 0.55)}, ${hexToRgba('#000000', 0.55)}), url(${section.imageUrl})` : undefined,
        backgroundColor: section.imageUrl ? undefined : hexToRgba(primary, 0.12),
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <h1 className={`text-3xl font-black tracking-tight sm:text-4xl ${section.imageUrl ? 'text-white' : 'text-gray-900'}`}>
        {section.title}
      </h1>
      {section.subtitle && (
        <p className={`max-w-md text-base ${section.imageUrl ? 'text-white/85' : 'text-gray-600'}`}>{section.subtitle}</p>
      )}
      {section.ctaLabel && (() => {
        const target = resolveCtaTarget(section.ctaHref, schema);
        const ctaClassName = 'mt-2 rounded-full px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90';
        return target.kind === 'nav' ? (
          <button type="button" onClick={() => onNavigate?.(target.slug)} className={ctaClassName} style={{ backgroundColor: primary }}>
            {section.ctaLabel}
          </button>
        ) : (
          <a href={target.href} className={ctaClassName} style={{ backgroundColor: primary }}>
            {section.ctaLabel}
          </a>
        );
      })()}
    </section>
  );
}

// ─── about ───────────────────────────────────────────────────────────────────
function AboutSection({ section }: SectionRendererPropsFor<'about'>) {
  return (
    <section className="px-6 py-10">
      <div className={`mx-auto flex max-w-3xl flex-col gap-6 ${section.imageUrl ? 'sm:flex-row sm:items-center' : ''}`}>
        {section.imageUrl && (
          <img src={section.imageUrl} alt="" onError={hideOnImageError} className="h-48 w-full rounded-2xl object-cover sm:w-1/2" />
        )}
        <div className={section.imageUrl ? 'sm:w-1/2' : ''}>
          <h2 className="mb-3 text-2xl font-bold text-gray-900">{section.title}</h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-gray-600">{section.body}</p>
        </div>
      </div>
    </section>
  );
}

// ─── gallery ─────────────────────────────────────────────────────────────────
function GallerySection({ section }: SectionRendererPropsFor<'gallery'>) {
  return (
    <section className="px-6 py-10">
      {section.title && <h2 className="mb-6 text-center text-2xl font-bold text-gray-900">{section.title}</h2>}
      {section.images.length > 0 ? (
        // flex-wrap invece di grid: quando il numero di immagini non è
        // multiplo delle colonne (es. 4 immagini su 3 colonne), un grid
        // lascerebbe le celle vuote dell'ultima riga come spazio bianco
        // "orfano" a destra — qui l'ultima riga incompleta viene invece
        // centrata, senza vuoto visibile.
        <div className="mx-auto flex max-w-4xl flex-wrap justify-center gap-3">
          {section.images.map((src, i) => (
            <img
              key={i}
              src={src}
              alt=""
              onError={hideOnImageError}
              className="aspect-square w-[calc(50%-0.375rem)] rounded-xl object-cover sm:w-[calc(33.333%-0.5rem)]"
            />
          ))}
        </div>
      ) : (
        <div className="mx-auto grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex aspect-square items-center justify-center rounded-xl bg-gray-100 text-xs text-gray-400">
              Immagine {i + 1}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── list ────────────────────────────────────────────────────────────────────
function ListSection({ section, schema, slug }: SectionRendererPropsFor<'list'>) {
  const primary = schema.ui.primaryColor;
  const entity = findEntity(schema, section.entity);

  // Sito pubblicato (slug presente) + sezione collegata a un'entità reale:
  // prova i dati veri da app_records (via LiveListSection) invece del mock.
  // In editor/anteprima (nessuno slug, l'app non è ancora pubblicata) resta
  // sempre il mock sotto, comportamento invariato.
  if (slug && section.entity) {
    return (
      <LiveListSection
        slug={slug}
        entity={section.entity}
        entityDef={entity}
        title={section.title}
        layout={section.layout}
        emptyLabel={section.emptyLabel}
        primary={primary}
      />
    );
  }

  const items = entity ? mockEntityItems(entity) : [];
  const priceField = entity?.fields.find((f) => f.type === 'currency' || f.type === 'number');
  const titleField = entity?.fields.find((f) => f.type === 'text' && f.id !== priceField?.id);

  return (
    <section className="px-6 py-10">
      {section.title && <h2 className="mb-6 text-center text-2xl font-bold text-gray-900">{section.title}</h2>}
      {items.length === 0 ? (
        <p className="text-center text-sm text-gray-400">{section.emptyLabel}</p>
      ) : (
        <div className={`mx-auto max-w-3xl ${section.layout === 'grid' ? 'grid grid-cols-1 gap-4 sm:grid-cols-2' : 'flex flex-col gap-3'}`}>
          {items.map((item, i) => (
            <div key={i} className="flex items-center justify-between gap-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
              <div>
                <div className="font-semibold text-gray-900">{titleField ? item[titleField.id] : entity?.label}</div>
                <div className="text-xs text-gray-500">{entity?.labelPlural}</div>
              </div>
              {priceField && (
                <div className="whitespace-nowrap text-sm font-bold" style={{ color: primary }}>
                  {item[priceField.id]}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── form ────────────────────────────────────────────────────────────────────
function FormSection({ section, schema }: SectionRendererPropsFor<'form'>) {
  const primary = schema.ui.primaryColor;
  const entity = section.entity ? findEntity(schema, section.entity) : undefined;
  const relationDefaults = { target: undefined, targetLabel: undefined, targetEntity: undefined, displayField: undefined, states: undefined, allowedTransitions: undefined };
  const genericFormFields: Field[] = [
    { id: 'nome', type: 'text', label: 'Nome', required: true, options: [], ...relationDefaults },
    { id: 'email', type: 'email', label: 'Email', required: true, options: [], ...relationDefaults },
    { id: 'messaggio', type: 'textarea', label: 'Messaggio', required: false, options: [], ...relationDefaults },
  ];
  const fields = entity ? entity.fields.filter((f) => f.type !== 'id') : genericFormFields;
  return (
    <section className="px-6 py-10">
      {section.title && <h2 className="mb-6 text-center text-2xl font-bold text-gray-900">{section.title}</h2>}
      <form className="mx-auto flex max-w-md flex-col gap-3" onSubmit={(e) => e.preventDefault()}>
        {fields.map((f) => (
          <label key={f.id} className="flex flex-col gap-1 text-left text-xs font-medium text-gray-600">
            {f.label}{f.required ? ' *' : ''}
            {f.type === 'textarea' ? (
              <textarea className="rounded-lg border border-gray-200 p-2.5 text-sm text-gray-800" rows={3} disabled />
            ) : (
              <input className="rounded-lg border border-gray-200 p-2.5 text-sm text-gray-800" type={f.type === 'email' ? 'email' : 'text'} disabled />
            )}
          </label>
        ))}
        <button
          type="button"
          className="mt-2 rounded-full px-6 py-2.5 text-sm font-semibold text-white shadow"
          style={{ backgroundColor: primary }}
        >
          {section.submitLabel}
        </button>
      </form>
    </section>
  );
}

// ─── contact ─────────────────────────────────────────────────────────────────
function ContactSection({ section, schema }: SectionRendererPropsFor<'contact'>) {
  const primary = schema.ui.primaryColor;
  const bc = schema.businessConfig;
  return (
    <section className="px-6 py-10">
      {section.title && <h2 className="mb-6 text-center text-2xl font-bold text-gray-900">{section.title}</h2>}
      <div className="mx-auto flex max-w-md flex-col gap-3 text-sm text-gray-700">
        {bc.address && <div className="flex items-center gap-2"><MapPin size={16} style={{ color: primary }} /> {bc.address}</div>}
        {bc.phone && <div className="flex items-center gap-2"><Phone size={16} style={{ color: primary }} /> {bc.phone}</div>}
        {bc.email && <div className="flex items-center gap-2"><Mail size={16} style={{ color: primary }} /> {bc.email}</div>}
        {bc.openingHours.length > 0 && (
          <div className="mt-3 rounded-xl bg-gray-50 p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Orari</div>
            {bc.openingHours.map((h, i) => (
              <div key={i} className="flex justify-between text-xs text-gray-600">
                <span>{h.day}</span><span>{h.hours}</span>
              </div>
            ))}
          </div>
        )}
        {section.showMap && (
          <div className="mt-2 flex h-32 items-center justify-center rounded-xl bg-gray-100 text-xs text-gray-400">
            Mappa — {bc.address || 'indirizzo non specificato'}
          </div>
        )}
      </div>
    </section>
  );
}

// ─── reviews ─────────────────────────────────────────────────────────────────
function ReviewsSection({ section, schema }: SectionRendererPropsFor<'reviews'>) {
  const primary = schema.ui.primaryColor;
  return (
    <section className="px-6 py-10">
      {section.title && <h2 className="mb-6 text-center text-2xl font-bold text-gray-900">{section.title}</h2>}
      <div className="mx-auto grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
        {section.items.map((r, i) => (
          <div key={i} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="mb-1 flex gap-0.5" style={{ color: primary }}>
              {Array.from({ length: r.rating }, (_, s) => <Star key={s} size={12} fill="currentColor" />)}
            </div>
            <p className="mb-2 text-xs text-gray-600">&quot;{r.text}&quot;</p>
            <div className="text-xs font-semibold text-gray-800">— {r.author}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── cta ─────────────────────────────────────────────────────────────────────
function CtaSection({ section, schema, onNavigate }: SectionRendererPropsFor<'cta'>) {
  const primary = schema.ui.primaryColor;
  return (
    <section className="px-6 py-12 text-center text-white" style={{ backgroundColor: primary }}>
      <h2 className="text-2xl font-bold">{section.title}</h2>
      {section.subtitle && <p className="mt-2 text-sm text-white/85">{section.subtitle}</p>}
      {(() => {
        const target = resolveCtaTarget(section.buttonHref, schema);
        const ctaClassName = 'mt-5 inline-block rounded-full bg-white px-6 py-3 text-sm font-semibold';
        return target.kind === 'nav' ? (
          <button type="button" onClick={() => onNavigate?.(target.slug)} className={ctaClassName} style={{ color: primary }}>
            {section.buttonLabel}
          </button>
        ) : (
          <a href={target.href} className={ctaClassName} style={{ color: primary }}>
            {section.buttonLabel}
          </a>
        );
      })()}
    </section>
  );
}

// ─── text ────────────────────────────────────────────────────────────────────
function TextSection({ section }: SectionRendererPropsFor<'text'>) {
  return (
    <section className="px-6 py-10">
      {section.title && <h2 className="mb-3 text-xl font-bold text-gray-900">{section.title}</h2>}
      <p className="whitespace-pre-line text-sm leading-relaxed text-gray-600">{section.body}</p>
    </section>
  );
}

// ─── Fallback (Fase 3, requisito 6) ─────────────────────────────────────────
// Un `section.type` sconosciuto NON deve mai far crashare l'intera pagina.
// Comportamento identico a quello che aveva lo switch originale per un
// branch non gestito (`default: return null`): nessuna sezione visibile,
// nessuna UI di errore inventata — con lo schema Zod attuale (discriminated
// union chiusa sui 9 valori) questo ramo non è raggiungibile da un
// PageSection validato, resta comunque il fallback esplicito richiesto per
// un type ignoto che arrivasse comunque (es. dati non passati da
// sanitizeSiteBlueprint).
export function SectionFallback() {
  return null;
}

// ─── Registrazione delle 9 entry predefinite ────────────────────────────────
// KNOWN_SECTION_TYPES (site-schema.ts) è la stessa lista usata da
// sanitizeSiteBlueprint per validare/normalizzare un PageSection: nessuna
// duplicazione, nessun rischio di drift tra "i type che lo schema accetta" e
// "i type che il Registry sa renderizzare".
const DEFAULT_SECTION_COMPONENTS: Record<(typeof KNOWN_SECTION_TYPES)[number], SectionComponent> = {
  hero: HeroSection as SectionComponent,
  about: AboutSection as SectionComponent,
  gallery: GallerySection as SectionComponent,
  list: ListSection as SectionComponent,
  form: FormSection as SectionComponent,
  contact: ContactSection as SectionComponent,
  reviews: ReviewsSection as SectionComponent,
  cta: CtaSection as SectionComponent,
  text: TextSection as SectionComponent,
};

// I cast `as SectionComponent` sopra sono l'unico punto in cui la
// narrowing per-type dei singoli renderer (SectionRendererPropsFor<'hero'>,
// ecc.) incontra la forma necessariamente "aperta" del Registry (che non può
// sapere staticamente, per una Map, quale branch della union corrisponde a
// quale chiave) — a runtime è sempre corretto: il Registry chiama
// `get(section.type)` e passa esattamente quel `section`, quindi il renderer
// registrato per "hero" riceve sempre e solo una sezione con type:'hero'.
for (const type of KNOWN_SECTION_TYPES) {
  if (!sectionComponentRegistry.has(type)) {
    sectionComponentRegistry.register(type, DEFAULT_SECTION_COMPONENTS[type]);
  }
}
