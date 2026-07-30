// ─── Site/PWA Blueprint Schema ──────────────────────────────────────────────
// Schema JSON per il motore di generazione "Sito Vetrina / Web App-PWA /
// E-Commerce Vetrina": distinto dal blueprint tabellare del Creator AI
// esistente (blueprint-schema.ts, pensato per gestionali admin), questo
// descrive un sito/app con pagine PUBBLICHE (Home, Menu, Prenota, Contatti)
// oltre al pannello admin per i dati che quelle pagine mostrano.
//
// Stessa strategia difensiva di blueprint-schema.ts: parse Zod con default
// permissivi, e un fallback di normalizzazione manuale per quando il modello
// restituisce JSON quasi valido ma non conforme in ogni dettaglio.

import { z } from 'zod';
import { FieldSchema, type Field } from './blueprint-schema';

// ─── Tipo progetto ──────────────────────────────────────────────────────────

export const ProjectTypeSchema = z.enum(['landing', 'webapp-pwa', 'ecommerce']);
export type ProjectType = z.infer<typeof ProjectTypeSchema>;

export const PROJECT_TYPES: { value: ProjectType; label: string; description: string; icon: string }[] = [
  {
    value: 'landing',
    label: 'Sito Vetrina / Landing',
    description: 'Per professionisti e artigiani: galleria, storia, mappa, contatti.',
    icon: '🖼️',
  },
  {
    value: 'webapp-pwa',
    label: 'Web App / PWA',
    description: 'Per pizzerie, ristoranti e saloni: menu interattivo, prenotazioni, pannello ordini.',
    icon: '📱',
  },
  {
    value: 'ecommerce',
    label: 'E-Commerce Vetrina',
    description: 'Per negozi: catalogo prodotti, carrello, ordini via WhatsApp o cassa.',
    icon: '🛍️',
  },
];

// ─── businessConfig ─────────────────────────────────────────────────────────

export const OpeningHourSchema = z.object({
  day: z.union([z.string(), z.number()]).transform((v) => String(v)).default(''),
  hours: z.union([z.string(), z.number()]).transform((v) => String(v)).default('Chiuso'),
});
export type OpeningHour = z.infer<typeof OpeningHourSchema>;

export const BusinessConfigSchema = z.object({
  name: z.union([z.string(), z.number()]).transform((v) => String(v)).default('La Mia Attività'),
  logoUrl: z.union([z.string(), z.null(), z.undefined()]).optional().transform((v) => v || ''),
  heroImageUrl: z.union([z.string(), z.null(), z.undefined()]).optional().transform((v) => v || ''),
  tagline: z.union([z.string(), z.null(), z.undefined()]).optional().transform((v) => v || ''),
  description: z.union([z.string(), z.null(), z.undefined()]).optional().transform((v) => v || ''),
  address: z.union([z.string(), z.null(), z.undefined()]).optional().transform((v) => v || ''),
  whatsapp: z.union([z.string(), z.null(), z.undefined()]).optional().transform((v) => v || ''),
  phone: z.union([z.string(), z.null(), z.undefined()]).optional().transform((v) => v || ''),
  email: z.union([z.string(), z.null(), z.undefined()]).optional().transform((v) => v || ''),
  openingHours: z.array(OpeningHourSchema).optional().default([]),
  // Lingua in cui l'app è stata generata (locale del Creator AI attivo al
  // momento della generazione, es. 'it'|'en'|'fr'|'de'|'es'): vincola i testi
  // generati dal modello e guida eventuali refactor/traduzioni successive.
  language: z.union([z.string(), z.null(), z.undefined()]).optional().transform((v) => v || 'it'),
});
export type BusinessConfig = z.infer<typeof BusinessConfigSchema>;

// ─── actionButtons ──────────────────────────────────────────────────────────

export const ActionButtonTypeSchema = z.enum(['call', 'whatsapp', 'map', 'email', 'custom']);
export type ActionButtonType = z.infer<typeof ActionButtonTypeSchema>;

export const ActionButtonSchema = z.object({
  type: ActionButtonTypeSchema.catch('custom'),
  label: z.union([z.string(), z.number()]).transform((v) => String(v)).default('Contattaci'),
  // Interpretazione dipende da `type`: numero per call/whatsapp, testo libero
  // per map (indirizzo, o vuoto per usare businessConfig.address), indirizzo
  // email per email, URL per custom.
  value: z.union([z.string(), z.null(), z.undefined()]).optional().transform((v) => v || ''),
  icon: z.union([z.string(), z.null(), z.undefined()]).optional().transform((v) => v || ''),
});
export type ActionButton = z.infer<typeof ActionButtonSchema>;

// ─── adminPanel ─────────────────────────────────────────────────────────────
// Riusa FieldSchema del blueprint tabellare esistente: stessi tipi di campo,
// stesso normalizzatore, niente duplicazione tra i due motori.

export const AdminEntitySchema = z.object({
  name: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).replace(/[^a-z0-9_]/gi, '_').toLowerCase())
    .default('elementi'),
  label: z.union([z.string(), z.number()]).transform((v) => String(v)).default('Elemento'),
  labelPlural: z.union([z.string(), z.number()]).transform((v) => String(v)).default('Elementi'),
  icon: z.union([z.string(), z.number(), z.null(), z.undefined()]).optional().transform((v) => (v == null ? '' : String(v))),
  fields: z.array(FieldSchema).min(1).max(50),
});
export type AdminEntity = z.infer<typeof AdminEntitySchema>;

export const AdminPanelSchema = z.object({
  entities: z.array(AdminEntitySchema).default([]),
});
export type AdminPanel = z.infer<typeof AdminPanelSchema>;

// ─── pages / sections ───────────────────────────────────────────────────────
// Vocabolario chiuso di tipi di sezione: l'AI deve scegliere tra questi, non
// generare componenti arbitrari — necessario per poter renderizzare in modo
// affidabile senza eseguire codice generato dal modello.

const str = (fallback = '') => z.union([z.string(), z.number(), z.null(), z.undefined()]).optional().transform((v) => (v == null ? fallback : String(v)));
const strReq = (fallback = '') => z.union([z.string(), z.number()]).transform((v) => String(v)).default(fallback);

export const HeroSectionSchema = z.object({
  type: z.literal('hero'),
  title: strReq('Benvenuto'),
  subtitle: str(),
  imageUrl: str(),
  ctaLabel: str(),
  ctaHref: str(),
});

export const AboutSectionSchema = z.object({
  type: z.literal('about'),
  title: strReq('Chi Siamo'),
  body: strReq(''),
  imageUrl: str(),
});

export const GallerySectionSchema = z.object({
  type: z.literal('gallery'),
  title: str('Galleria'),
  images: z.array(z.string()).optional().default([]),
});

// Elenco dinamico: pesca gli elementi da un'entità di adminPanel.entities
// (es. "prodotti", "menu") — usato per le pagine Menu/Catalogo.
export const ListSectionSchema = z.object({
  type: z.literal('list'),
  title: str(''),
  entity: strReq(''),
  layout: z.enum(['grid', 'list']).catch('grid'),
  emptyLabel: str('Nessun elemento disponibile al momento.'),
});

// Form legato a un'entità admin (es. "prenotazioni") — pagina Prenota, o
// form di contatto quando entity è vuoto (in quel caso genera solo
// nome/email/messaggio, vedi SitePreview).
export const FormSectionSchema = z.object({
  type: z.literal('form'),
  title: str('Prenota'),
  entity: str(''),
  submitLabel: str('Invia'),
});

export const ContactSectionSchema = z.object({
  type: z.literal('contact'),
  title: str('Contatti'),
  showMap: z.union([z.boolean(), z.string()]).optional().transform((v) => v !== false && v !== 'false').default(true),
  showForm: z.union([z.boolean(), z.string()]).optional().transform((v) => v === true || v === 'true').default(false),
});

export const ReviewItemSchema = z.object({
  author: strReq('Cliente'),
  text: strReq(''),
  rating: z.union([z.number(), z.string()]).optional().transform((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : 5;
  }).default(5),
});

export const ReviewsSectionSchema = z.object({
  type: z.literal('reviews'),
  title: str('Cosa dicono di noi'),
  items: z.array(ReviewItemSchema).optional().default([]),
});

export const CtaSectionSchema = z.object({
  type: z.literal('cta'),
  title: strReq('Pronto a iniziare?'),
  subtitle: str(),
  buttonLabel: strReq('Contattaci'),
  buttonHref: str(''),
});

export const TextSectionSchema = z.object({
  type: z.literal('text'),
  title: str(''),
  body: strReq(''),
});

export const PageSectionSchema = z.discriminatedUnion('type', [
  HeroSectionSchema,
  AboutSectionSchema,
  GallerySectionSchema,
  ListSectionSchema,
  FormSectionSchema,
  ContactSectionSchema,
  ReviewsSectionSchema,
  CtaSectionSchema,
  TextSectionSchema,
]);
export type PageSection = z.infer<typeof PageSectionSchema>;
export type PageSectionType = PageSection['type'];

const KNOWN_SECTION_TYPES: PageSectionType[] = [
  'hero', 'about', 'gallery', 'list', 'form', 'contact', 'reviews', 'cta', 'text',
];

export const SitePageSchema = z.object({
  slug: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, ''))
    .default('home'),
  label: z.union([z.string(), z.number()]).transform((v) => String(v)).default('Home'),
  sections: z.array(PageSectionSchema).default([]),
});
export type SitePage = z.infer<typeof SitePageSchema>;

// ─── Blueprint completo ─────────────────────────────────────────────────────

export const SiteUIConfigSchema = z.object({
  primaryColor: z
    .string()
    .optional()
    .transform((v) => {
      const s = (v || '#6366f1').trim();
      return s.startsWith('#') ? s : `#${s}`;
    })
    .default('#6366f1'),
  secondaryColor: z
    .union([z.string(), z.null(), z.undefined()])
    .optional()
    .transform((v) => {
      if (!v) return undefined;
      return v.startsWith('#') ? v : `#${v}`;
    }),
  font: z.union([z.string(), z.null(), z.undefined()]).optional().transform((v) => v || 'Inter'),
});
export type SiteUIConfig = z.infer<typeof SiteUIConfigSchema>;

export const SiteBlueprintSchema = z.object({
  projectType: ProjectTypeSchema.catch('landing'),
  appName: z.union([z.string(), z.number()]).transform((v) => String(v)).default('Il Mio Sito'),
  sector: z.union([z.string(), z.number()]).transform((v) => String(v)).default('custom'),
  description: str(),
  businessConfig: BusinessConfigSchema,
  adminPanel: AdminPanelSchema,
  pages: z.array(SitePageSchema).min(1),
  actionButtons: z.array(ActionButtonSchema).optional().default([]),
  ui: SiteUIConfigSchema,
});
export type SiteBlueprintJSON = z.infer<typeof SiteBlueprintSchema>;

// ─── Normalizzazione manuale (fallback) ─────────────────────────────────────
// Stesso approccio di blueprint-schema.ts::sanitizeBlueprint: prova prima lo
// schema Zod stretto, e se fallisce prova a recuperare comunque un blueprint
// utilizzabile da un output quasi-valido invece di buttarlo via.

function safeStr(v: unknown, fallback = ''): string {
  if (v == null) return fallback;
  return String(v);
}

function normalizeSection(raw: any): PageSection | null {
  if (!raw || typeof raw !== 'object') return null;
  const type = safeStr(raw.type).toLowerCase();
  if (!KNOWN_SECTION_TYPES.includes(type as PageSectionType)) return null;

  try {
    return PageSectionSchema.parse({ ...raw, type });
  } catch {
    // Ricostruzione minima per tipo, così una sezione quasi valida non
    // sparisce dalla pagina solo per un campo mancante malformato.
    switch (type as PageSectionType) {
      case 'hero':
        return { type: 'hero', title: safeStr(raw.title, 'Benvenuto'), subtitle: safeStr(raw.subtitle), imageUrl: safeStr(raw.imageUrl), ctaLabel: safeStr(raw.ctaLabel), ctaHref: safeStr(raw.ctaHref) };
      case 'about':
        return { type: 'about', title: safeStr(raw.title, 'Chi Siamo'), body: safeStr(raw.body), imageUrl: safeStr(raw.imageUrl) };
      case 'gallery':
        return { type: 'gallery', title: safeStr(raw.title, 'Galleria'), images: Array.isArray(raw.images) ? raw.images.map((i: unknown) => safeStr(i)).filter(Boolean) : [] };
      case 'list':
        return { type: 'list', title: safeStr(raw.title), entity: safeStr(raw.entity), layout: raw.layout === 'list' ? 'list' : 'grid', emptyLabel: safeStr(raw.emptyLabel, 'Nessun elemento disponibile al momento.') };
      case 'form':
        return { type: 'form', title: safeStr(raw.title, 'Prenota'), entity: safeStr(raw.entity), submitLabel: safeStr(raw.submitLabel, 'Invia') };
      case 'contact':
        return { type: 'contact', title: safeStr(raw.title, 'Contatti'), showMap: raw.showMap !== false, showForm: raw.showForm === true };
      case 'reviews':
        return { type: 'reviews', title: safeStr(raw.title, 'Cosa dicono di noi'), items: Array.isArray(raw.items) ? raw.items.map((i: any) => ({ author: safeStr(i?.author, 'Cliente'), text: safeStr(i?.text), rating: 5 })) : [] };
      case 'cta':
        return { type: 'cta', title: safeStr(raw.title, 'Pronto a iniziare?'), subtitle: safeStr(raw.subtitle), buttonLabel: safeStr(raw.buttonLabel, 'Contattaci'), buttonHref: safeStr(raw.buttonHref) };
      case 'text':
        return { type: 'text', title: safeStr(raw.title), body: safeStr(raw.body) };
      default:
        return null;
    }
  }
}

function normalizePage(raw: any): SitePage {
  const sections = Array.isArray(raw?.sections)
    ? raw.sections.map(normalizeSection).filter((s: PageSection | null): s is PageSection => s !== null)
    : [];
  return {
    slug: safeStr(raw?.slug ?? raw?.name, 'home').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'home',
    label: safeStr(raw?.label ?? raw?.title, 'Home'),
    sections,
  };
}

function normalizeAdminEntity(raw: any): AdminEntity | null {
  if (!raw || typeof raw !== 'object') return null;
  const fields = Array.isArray(raw.fields) ? raw.fields : [];
  if (fields.length === 0) return null;
  try {
    return AdminEntitySchema.parse(raw);
  } catch {
    return null;
  }
}

function normalizeActionButton(raw: any): ActionButton | null {
  if (!raw || typeof raw !== 'object') return null;
  try {
    return ActionButtonSchema.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Valida/normalizza l'output del modello (o di un refactor via chat) in un
 * SiteBlueprintJSON utilizzabile. Ritorna null solo se il JSON è così
 * malformato da non contenere nemmeno una pagina recuperabile.
 */
export function sanitizeSiteBlueprint(raw: unknown): SiteBlueprintJSON | null {
  if (!raw || typeof raw !== 'object') return null;

  try {
    const result = SiteBlueprintSchema.parse(raw);
    if (result.pages.length > 0) return result;
  } catch {
    // fall through al recupero manuale
  }

  const r = raw as Record<string, any>;
  const pages = Array.isArray(r.pages) ? r.pages.map(normalizePage).filter((p: SitePage) => p.sections.length > 0) : [];
  if (pages.length === 0) return null;

  const entities = Array.isArray(r.adminPanel?.entities)
    ? r.adminPanel.entities.map(normalizeAdminEntity).filter((e: AdminEntity | null): e is AdminEntity => e !== null)
    : [];

  const actionButtons = Array.isArray(r.actionButtons)
    ? r.actionButtons.map(normalizeActionButton).filter((b: ActionButton | null): b is ActionButton => b !== null)
    : [];

  const bc = r.businessConfig || {};
  const businessConfig: BusinessConfig = {
    name: safeStr(bc.name, 'La Mia Attività'),
    logoUrl: safeStr(bc.logoUrl),
    heroImageUrl: safeStr(bc.heroImageUrl),
    tagline: safeStr(bc.tagline),
    description: safeStr(bc.description),
    address: safeStr(bc.address),
    whatsapp: safeStr(bc.whatsapp),
    phone: safeStr(bc.phone),
    email: safeStr(bc.email),
    openingHours: Array.isArray(bc.openingHours)
      ? bc.openingHours.map((h: any) => ({ day: safeStr(h?.day), hours: safeStr(h?.hours, 'Chiuso') }))
      : [],
    language: safeStr(bc.language, 'it'),
  };

  const uiRaw = r.ui || {};
  const primaryColor = safeStr(uiRaw.primaryColor, '#6366f1');

  return {
    projectType: (['landing', 'webapp-pwa', 'ecommerce'] as const).includes(r.projectType) ? r.projectType : 'landing',
    appName: safeStr(r.appName ?? r.name, 'Il Mio Sito'),
    sector: safeStr(r.sector, 'custom'),
    description: safeStr(r.description),
    businessConfig,
    adminPanel: { entities },
    pages,
    actionButtons,
    ui: {
      primaryColor: primaryColor.startsWith('#') ? primaryColor : `#${primaryColor}`,
      secondaryColor: uiRaw.secondaryColor ? safeStr(uiRaw.secondaryColor) : undefined,
      font: safeStr(uiRaw.font, 'Inter'),
    },
  };
}

export type { Field };
