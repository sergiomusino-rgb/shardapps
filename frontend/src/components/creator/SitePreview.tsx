'use client';

// ─── SitePreview ────────────────────────────────────────────────────────────
// Renderizza le pagine pubbliche di un SiteBlueprintJSON (site-schema.ts):
// nessun testo hardcoded, ogni contenuto arriva da businessConfig/pages/
// adminPanel. Le sezioni "list"/"form" (Menu/Catalogo/Prenota) non hanno
// ancora dati reali finché l'app non è creata e usata (i record veri vivono
// in app_records, popolati dopo /api/creator/create): qui mostrano dati di
// esempio generati dai field type dell'entità collegata, stesso approccio
// del mock già usato in DynamicAppPreview.tsx per il motore gestionali.

import { useMemo } from 'react';
import { Phone, MessageCircle, MapPin, Mail, Star, Menu as MenuIcon } from 'lucide-react';
import type {
  SiteBlueprintJSON,
  SitePage,
  PageSection,
  ActionButton,
  AdminEntity,
} from '@/src/lib/site-schema';
import type { Field } from '@/src/lib/blueprint-schema';

// ─── Helpers colore ─────────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const clean = (hex || '#6366f1').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return `rgba(99,102,241,${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─── Mock dati per le entità admin (list/form) ──────────────────────────────

function mockValueForField(field: Field, seed: number): string {
  switch (field.type) {
    case 'number':
      return String(50 + seed * 15);
    case 'currency':
      return `€ ${(6.5 + seed * 2.5).toFixed(2)}`;
    case 'select':
    case 'multiselect':
      return field.options?.[seed % Math.max(field.options.length, 1)] || '—';
    case 'image':
      return '';
    default:
      return ['Voce di esempio', 'Altra voce', 'Terza voce'][seed % 3];
  }
}

function mockEntityItems(entity: AdminEntity, count = 3): Record<string, string>[] {
  return Array.from({ length: count }, (_, seed) => {
    const item: Record<string, string> = {};
    for (const field of entity.fields) {
      if (field.type === 'id') continue;
      item[field.id] = mockValueForField(field, seed);
    }
    return item;
  });
}

function findEntity(schema: SiteBlueprintJSON, name: string): AdminEntity | undefined {
  return schema.adminPanel.entities.find((e) => e.name === name);
}

// ─── Action buttons (call/whatsapp/map/email/custom) ────────────────────────

function resolveActionHref(button: ActionButton, schema: SiteBlueprintJSON): string {
  const bc = schema.businessConfig;
  switch (button.type) {
    case 'call':
      return `tel:${(button.value || bc.phone || '').replace(/\s+/g, '')}`;
    case 'whatsapp': {
      const number = (button.value || bc.whatsapp || bc.phone || '').replace(/[^0-9+]/g, '');
      return number ? `https://wa.me/${number.replace(/^\+/, '')}` : '#';
    }
    case 'map':
      return `https://maps.google.com/?q=${encodeURIComponent(button.value || bc.address || bc.name)}`;
    case 'email':
      return `mailto:${button.value || bc.email || ''}`;
    default:
      return button.value || '#';
  }
}

// ─── Risoluzione CTA hero/cta (testo libero scritto dall'AI in generazione) ─
// A differenza degli actionButtons (tipizzati call/whatsapp/map/email/custom,
// sempre risolti in uno schema sicuro da resolveActionHref sopra), ctaHref
// (hero) e buttonHref (cta) sono stringhe libere scritte dall'AI in
// generazione (vedi HeroSectionSchema/CtaSectionSchema in site-schema.ts):
// spesso un percorso "di fantasia" tipo "/preventivo" o "/contatti" che non
// corrisponde a nessuna route reale — Next.js qui non fa alcun fallback, dà
// un 404 secco. La navigazione interna del sito è sempre a stato (SiteNav
// sopra chiama onNavigate, mai un href reale): un percorso che corrisponde a
// una pagina del sito va risolto sullo stesso meccanismo invece di finire
// come href letterale.
type CtaTarget = { kind: 'nav'; slug: string } | { kind: 'link'; href: string };

function resolveCtaTarget(rawHref: string | undefined, schema: SiteBlueprintJSON): CtaTarget {
  const raw = (rawHref || '').trim();
  const normalized = raw.replace(/^[#/]+/, '').toLowerCase();

  if (normalized) {
    const page = schema.pages.find(
      (p) => p.slug.toLowerCase() === normalized || p.label.toLowerCase() === normalized
    );
    if (page) return { kind: 'nav', slug: page.slug };
  }

  if (/^(tel:|mailto:|https?:\/\/)/i.test(raw)) {
    return { kind: 'link', href: raw };
  }

  // Nessuna pagina né URL riconosciuto: il primo pulsante di contatto
  // configurato (chiamata/whatsapp/mappa/email) resta sempre valido ed è
  // comunque un'azione sensata per una CTA come "Chiedi un preventivo",
  // molto meglio di un link che porta a un 404.
  if (schema.actionButtons.length > 0) {
    return { kind: 'link', href: resolveActionHref(schema.actionButtons[0], schema) };
  }

  return { kind: 'link', href: '#' };
}

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

function SectionRenderer({
  section,
  schema,
  onNavigate,
}: {
  section: PageSection;
  schema: SiteBlueprintJSON;
  onNavigate?: (slug: string) => void;
}) {
  const primary = schema.ui.primaryColor;

  switch (section.type) {
    case 'hero':
      return (
        <section
          className="relative flex flex-col items-center justify-center gap-4 px-6 py-20 text-center"
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

    case 'about':
      return (
        <section className="px-6 py-14">
          <div className={`mx-auto flex max-w-3xl flex-col gap-6 ${section.imageUrl ? 'sm:flex-row sm:items-center' : ''}`}>
            {section.imageUrl && (
              <img src={section.imageUrl} alt="" className="h-48 w-full rounded-2xl object-cover sm:w-1/2" />
            )}
            <div className={section.imageUrl ? 'sm:w-1/2' : ''}>
              <h2 className="mb-3 text-2xl font-bold text-gray-900">{section.title}</h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-gray-600">{section.body}</p>
            </div>
          </div>
        </section>
      );

    case 'gallery':
      return (
        <section className="px-6 py-14">
          {section.title && <h2 className="mb-6 text-center text-2xl font-bold text-gray-900">{section.title}</h2>}
          {section.images.length > 0 ? (
            <div className="mx-auto grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-3">
              {section.images.map((src, i) => (
                <img key={i} src={src} alt="" className="aspect-square w-full rounded-xl object-cover" />
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

    case 'list': {
      const entity = findEntity(schema, section.entity);
      const items = entity ? mockEntityItems(entity) : [];
      const priceField = entity?.fields.find((f) => f.type === 'currency' || f.type === 'number');
      const titleField = entity?.fields.find((f) => f.type === 'text' && f.id !== priceField?.id);

      return (
        <section className="px-6 py-14">
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

    case 'form': {
      const entity = section.entity ? findEntity(schema, section.entity) : undefined;
      const genericFormFields: Field[] = [
        { id: 'nome', type: 'text', label: 'Nome', required: true, options: [], target: undefined, targetLabel: undefined },
        { id: 'email', type: 'email', label: 'Email', required: true, options: [], target: undefined, targetLabel: undefined },
        { id: 'messaggio', type: 'textarea', label: 'Messaggio', required: false, options: [], target: undefined, targetLabel: undefined },
      ];
      const fields = entity ? entity.fields.filter((f) => f.type !== 'id') : genericFormFields;
      return (
        <section className="px-6 py-14">
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

    case 'contact': {
      const bc = schema.businessConfig;
      return (
        <section className="px-6 py-14">
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

    case 'reviews':
      return (
        <section className="px-6 py-14">
          {section.title && <h2 className="mb-6 text-center text-2xl font-bold text-gray-900">{section.title}</h2>}
          <div className="mx-auto grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
            {section.items.map((r, i) => (
              <div key={i} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                <div className="mb-1 flex gap-0.5" style={{ color: primary }}>
                  {Array.from({ length: r.rating }, (_, s) => <Star key={s} size={12} fill="currentColor" />)}
                </div>
                <p className="mb-2 text-xs text-gray-600">"{r.text}"</p>
                <div className="text-xs font-semibold text-gray-800">— {r.author}</div>
              </div>
            ))}
          </div>
        </section>
      );

    case 'cta':
      return (
        <section className="px-6 py-16 text-center text-white" style={{ backgroundColor: primary }}>
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

    case 'text':
      return (
        <section className="px-6 py-10">
          {section.title && <h2 className="mb-3 text-xl font-bold text-gray-900">{section.title}</h2>}
          <p className="whitespace-pre-line text-sm leading-relaxed text-gray-600">{section.body}</p>
        </section>
      );

    default:
      return null;
  }
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
}: {
  schema: SiteBlueprintJSON;
  activePageSlug?: string;
  onNavigate?: (slug: string) => void;
}) {
  const activePage: SitePage = useMemo(() => {
    return schema.pages.find((p) => p.slug === activePageSlug) || schema.pages[0];
  }, [schema.pages, activePageSlug]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-white">
      <SiteNav schema={schema} activeSlug={activePage.slug} onNavigate={(slug) => onNavigate?.(slug)} />
      <div className="flex-1 overflow-y-auto">
        {activePage.sections.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center text-gray-400">
            <MenuIcon size={28} />
            <p className="text-sm">Questa pagina non ha ancora sezioni.</p>
          </div>
        ) : (
          activePage.sections.map((section, i) => (
            <SectionRenderer key={i} section={section} schema={schema} onNavigate={onNavigate} />
          ))
        )}
      </div>
      <StickyActionBar schema={schema} />
    </div>
  );
}
