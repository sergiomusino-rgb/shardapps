'use client';

// ─── SitePreview — utility condivise ────────────────────────────────────────
// Estratte da SitePreview.tsx (Fase 3 — Component Registry): funzioni/
// componenti usati sia dai renderer di sezione (frontend/src/components/
// creator/sections/index.tsx) sia dal guscio di SitePreview.tsx stesso
// (SiteNav, StickyActionBar) — nessuna logica riscritta, solo spostata così
// com'era, per evitare la duplicazione che si sarebbe creata tenendole
// dentro SitePreview.tsx mentre i renderer si spostavano altrove.

import { useEffect, useState, type SyntheticEvent } from 'react';
import type {
  SiteBlueprintJSON,
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
export function hideOnImageError(e: SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.style.display = 'none';
}

export function hexToRgba(hex: string, alpha: number): string {
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

export function mockValueForField(field: Field, seed: number): string {
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

export function mockEntityItems(entity: AdminEntity, count = 3): Record<string, string>[] {
  return Array.from({ length: count }, (_, seed) => {
    const item: Record<string, string> = {};
    for (const field of entity.fields) {
      if (field.type === 'id') continue;
      item[field.id] = mockValueForField(field, seed);
    }
    return item;
  });
}

export function findEntity(schema: SiteBlueprintJSON, name: string): AdminEntity | undefined {
  return schema.adminPanel.entities.find((e) => e.name === name);
}

// ─── Action buttons (call/whatsapp/map/email/custom) ────────────────────────

export function resolveActionHref(button: ActionButton, schema: SiteBlueprintJSON): string {
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
// chiama onNavigate, mai un href reale): un percorso che corrisponde a una
// pagina del sito va risolto sullo stesso meccanismo invece di finire come
// href letterale.
export type CtaTarget = { kind: 'nav'; slug: string } | { kind: 'link'; href: string };

export function resolveCtaTarget(rawHref: string | undefined, schema: SiteBlueprintJSON): CtaTarget {
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

// NOTA: `actionIcon` (usata solo da StickyActionBar, mai da un renderer di
// sezione) resta in SitePreview.tsx, non spostata qui — nessun caso d'uso
// nei 9 renderer richiede di condividerla.

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
export type LiveListItem = Record<string, string> & { id?: string; relations?: Record<string, string> };

export function useLiveEntityRecords(slug: string, entity: string): { items: LiveListItem[] | null } {
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

export function LiveListSection({
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
