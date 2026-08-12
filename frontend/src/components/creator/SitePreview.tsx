'use client';

// ─── SitePreview ────────────────────────────────────────────────────────────
// Renderizza le pagine pubbliche di un SiteBlueprintJSON (site-schema.ts):
// nessun testo hardcoded, ogni contenuto arriva da businessConfig/pages/
// adminPanel. Le sezioni "form" (Prenota) restano sempre un mock statico
// (nessuna sottomissione reale da qui). Le sezioni "list" (Menu/Catalogo)
// mostrano dati di esempio generati dai field type dell'entità collegata
// SOLO quando non c'è ancora uno slug pubblico (editor/anteprima, l'app non è
// stata pubblicata) — una volta pubblicata (slug presente, /a/[slug]) i dati
// reali arrivano da GET /api/public/apps/[slug]/records (LiveListSection più
// sotto), con lo stesso mock come placeholder ottimistico finché la rete non
// risponde. Le sezioni "gallery" restano invariate: le immagini vivono
// inline nello schema (section.images), non sono legate a un'entità.

import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
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

// L'AI in generazione inventa URL Unsplash "plausibili" quando non ha foto
// reali (vedi il prompt in app/api/creator/generate/route.ts): l'ID foto può
// non esistere davvero su Unsplash e l'<img> mostrerebbe l'icona nativa di
// immagine rotta del browser — su una galleria, uno spazio vuoto/rotto
// visivamente pesante. Nascondere l'elemento invece di lasciare l'icona: in
// un contenitore flex la riga si ricompone sulle immagini rimaste, senza
// buchi.
function hideOnImageError(e: SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.style.display = 'none';
}

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

// ─── Sezione "list" sul sito pubblicato: dati reali da app_records ──────────
// Attiva solo quando SitePreview riceve uno `slug` (sito pubblicato, vedi
// app/a/[slug]/page.tsx -> PublicSiteRenderer): l'editor (AppEditorView,
// nessuno slug perché l'app non è ancora pubblicata) continua a mostrare
// sempre il mock in SectionRenderer, comportamento invariato. Componente
// dedicato (non un ramo in più dentro SectionRenderer) apposta: possiede da
// solo lo stato/l'effetto di fetch, senza introdurre hook condizionali nello
// switch di SectionRenderer (che resta un unico componente con tutti i rami).
// `relations`: etichette già risolte lato server (endpoint pubblico,
// ?include_relations=true) per gli eventuali campi type:'relation'
// dell'entità — es. { cliente_id: "Mario Rossi" } — mai calcolate qui: senza
// autenticazione questo componente non ha modo di leggere l'entità target
// per conto suo, deve fidarsi solo di quanto l'endpoint ha già risolto.
type LiveListItem = Record<string, string> & { id?: string; relations?: Record<string, string> };

function useLiveEntityRecords(slug: string, entity: string): { items: LiveListItem[] | null } {
  const [items, setItems] = useState<LiveListItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Niente reset sincrono di `items` qui (react-hooks/set-state-in-effect):
    // lo stato iniziale è già `null` (= "mostra il mock finché non arriva una
    // risposta"), e slug/entity sono stabili per l'intera vita di questo
    // componente (una LiveListSection per sezione "list", montata una sola
    // volta sulla pagina pubblica) — non serve invalidare un valore precedente.

    fetch(`/api/public/apps/${encodeURIComponent(slug)}/records?entity=${encodeURIComponent(entity)}&include_relations=true`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { success?: boolean; data?: { records?: { id: string; data: Record<string, unknown>; relations?: Record<string, string> }[] } } | null) => {
        if (cancelled) return;
        const records = json?.success ? json.data?.records : undefined;
        if (!Array.isArray(records)) {
          setItems([]);
          return;
        }
        setItems(records.map((r) => {
          const row: LiveListItem = { id: r.id };
          for (const [key, value] of Object.entries(r.data || {})) {
            row[key] = value == null ? '' : String(value);
          }
          if (r.relations && Object.keys(r.relations).length > 0) row.relations = r.relations;
          return row;
        }));
      })
      .catch(() => {
        // Rete/endpoint non disponibile: nessuno stato di errore visibile sul
        // sito pubblico, resta il mock (vedi sotto) per un problema tecnico
        // transitorio invece di mostrare una sezione rotta a un visitatore reale.
        if (!cancelled) setItems(null);
      });

    return () => { cancelled = true; };
  }, [slug, entity]);

  return { items };
}

function LiveListSection({
  slug,
  entity,
  entityDef,
  title,
  layout,
  emptyLabel,
  primary,
}: {
  slug: string;
  entity: string;
  entityDef?: AdminEntity;
  title?: string;
  layout: 'grid' | 'list';
  emptyLabel: string;
  primary: string;
}) {
  const { items } = useLiveEntityRecords(slug, entity);
  const isLive = items !== null;
  // Prima che la rete risponda (o se la fetch fallisce): stessi dati di
  // esempio del motore mock, per non mostrare un vuoto/flash sulla prima
  // pagina vista da un visitatore reale.
  const displayItems: LiveListItem[] = isLive ? items : (entityDef ? mockEntityItems(entityDef) : []);

  const priceField = entityDef?.fields.find((f) => f.type === 'currency' || f.type === 'number');
  const titleField = entityDef?.fields.find((f) => f.type === 'text' && f.id !== priceField?.id);
  // Primo campo di relazione dell'entità (es. "cliente_id" su "ordini"): se
  // presente, mostra l'etichetta già risolta dall'endpoint (item.relations)
  // come riga informativa in più — mai calcolata qui, solo quella che il
  // server ha già risolto in modo sicuro (?include_relations=true).
  const relationField = entityDef?.fields.find((f) => f.type === 'relation');

  return (
    <section className="px-6 py-10">
      {title && <h2 className="mb-6 text-center text-2xl font-bold text-gray-900">{title}</h2>}
      {isLive && displayItems.length === 0 ? (
        <p className="text-center text-sm text-gray-400">{emptyLabel}</p>
      ) : (
        <div className={`mx-auto max-w-3xl ${layout === 'grid' ? 'grid grid-cols-1 gap-4 sm:grid-cols-2' : 'flex flex-col gap-3'}`}>
          {displayItems.map((item, i) => (
            <div key={item.id ?? i} className="flex items-center justify-between gap-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
              <div>
                <div className="font-semibold text-gray-900">{titleField ? item[titleField.id] : entityDef?.label}</div>
                <div className="text-xs text-gray-500">
                  {relationField && item.relations?.[relationField.id]
                    ? `${relationField.label}: ${item.relations[relationField.id]}`
                    : entityDef?.labelPlural}
                </div>
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

// ─── Sezioni ─────────────────────────────────────────────────────────────────

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
   * "list" collegate a un'entità, vedi sopra. */
  slug?: string;
}) {
  const primary = schema.ui.primaryColor;

  switch (section.type) {
    case 'hero':
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

    case 'about':
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

    case 'gallery':
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

    case 'list': {
      const entity = findEntity(schema, section.entity);

      // Sito pubblicato (slug presente) + sezione collegata a un'entità
      // reale: prova i dati veri da app_records (via LiveListSection) invece
      // del mock. In editor/anteprima (nessuno slug, l'app non è ancora
      // pubblicata) resta sempre il mock sotto, comportamento invariato.
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

    case 'form': {
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

    case 'contact': {
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

    case 'reviews':
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

    case 'cta':
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
            <SectionRenderer key={i} section={section} schema={schema} onNavigate={onNavigate} slug={slug} />
          ))
        )}
      </div>
      <StickyActionBar schema={schema} />
    </div>
  );
}
