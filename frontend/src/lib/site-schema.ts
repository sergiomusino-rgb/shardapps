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

// ─── Ruoli utente (auth multi-utente, Fase 3) ───────────────────────────────
// Gerarchia fissa admin > operator > viewer, usata sia per validare
// requiredRole/defaultRole qui sia lato runtime (backend/lib/client-auth.js,
// DynamicDataTable/DynamicRecordModal) per confrontare "il ruolo dell'utente
// è sufficiente per questa azione".
export const AppRoleSchema = z.enum(['admin', 'operator', 'viewer']);
export type AppRole = z.infer<typeof AppRoleSchema>;

// ─── authConfig ─────────────────────────────────────────────────────────────
// Config tecnica dell'autenticazione multi-utente dell'app generata — separata
// da businessConfig (dati anagrafici dell'attività) perché non è un dato che
// il titolare compila, ma una scelta strutturale del motore. Assente/enabled
// false = comportamento invariato (auth_mode resta 'legacy', vedi
// app/api/creator/publish/route.ts): retrocompatibilità totale, nessuna app
// esistente ha mai avuto questo campo.
export const AuthConfigSchema = z.object({
  enabled: z.union([z.boolean(), z.string()]).optional().transform((v) => v === true || v === 'true').default(false),
  supportedRoles: z
    .union([z.array(AppRoleSchema), z.null(), z.undefined()])
    .optional()
    .transform((v) => {
      const roles = Array.isArray(v) ? Array.from(new Set(v)) : [];
      // 'admin' è sempre incluso: senza almeno un admin nessuno potrebbe
      // gestire l'app rbac (creare altri utenti, cambiare configurazione).
      return roles.includes('admin') ? roles : [...roles, 'admin'];
    })
    .default(['admin']),
  defaultRole: z
    .union([z.enum(['operator', 'viewer']), z.null(), z.undefined()])
    .optional()
    .transform((v) => v ?? 'viewer'),
});
export type AuthConfig = z.infer<typeof AuthConfigSchema>;

// ─── webhookUrl: check "ovvio" senza DNS (Security Audit Fase 4, fix BLOCKER) ─
// Prima linea di difesa SOLO allo storage: rifiuta IP letterali privati/
// riservati e hostname localhost-like scritti direttamente nell'URL. NON può
// bastare da sola — un hostname pubblico può comunque risolvere verso un IP
// privato in seguito (DNS rebinding, record modificato dal proprietario del
// dominio, o semplicemente un dominio interno legittimo con A record privato)
// e questa funzione, sincrona, non fa risoluzione DNS. La barriera
// autoritativa è backend/lib/ssrf-guard.js::validateWebhookUrl, che risolve
// l'hostname via DNS ad ogni esecuzione dell'azione, non solo al salvataggio.
function ipv4ToLong(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);
  const ipLong = ipv4ToLong(ip);
  const rangeLong = ipv4ToLong(range);
  if (ipLong === null || rangeLong === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipLong & mask) === (rangeLong & mask);
}

// Stessa denylist IPv4 di backend/lib/ssrf-guard.js (tenuta volutamente
// duplicata, non condivisa: frontend e backend sono due package Node
// separati in questo repo, niente import cross-package).
const IPV4_DENYLIST = [
  '0.0.0.0/8', '127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16',
  '169.254.0.0/16', '100.64.0.0/10', '192.0.0.0/24', '192.0.2.0/24',
  '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4',
  '240.0.0.0/4', '255.255.255.255/32',
];

function isObviouslyUnsafeWebhookHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // spoglia le parentesi di un IPv6 letterale
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    return IPV4_DENYLIST.some((cidr) => ipv4InCidr(h, cidr));
  }
  // Controlli IPv6 SOLO se l'host è letteralmente un IPv6 (contiene ':'):
  // un semplice startsWith('fc'/'fd') su un hostname normale darebbe un
  // falso positivo su domini legittimi come "fcbank.com" o "fdgroup.io".
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return true; // loopback / unspecified
    if (h.startsWith('fe80:')) return true; // link-local
    if (/^f[cd][0-9a-f]{0,2}:/.test(h)) return true; // unique-local fc00::/7 (fc.. o fd..)
  }
  return false;
}

// ─── adminPanel.entities[].actions ──────────────────────────────────────────
// Vocabolario chiuso di azioni eseguibili su un record di un'entità, stesso
// principio delle sezioni di pagina (site-schema.ts, PageSectionSchema):
// l'AI sceglie tra questi 3 tipi, mai codice arbitrario, così l'esecuzione
// resta un dispatch sicuro lato server (vedi backend/routes/client-app.js,
// POST .../records/:recordId/actions/:actionId) invece di eseguire qualunque
// cosa il modello abbia scritto.
export const EntityActionSchema = z.object({
  id: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).replace(/[^a-z0-9_]/gi, '_').toLowerCase())
    .default('azione'),
  label: z.union([z.string(), z.number()]).transform((v) => String(v)).default('Azione'),
  type: z.enum(['change_state', 'trigger_webhook', 'send_notification']).catch('change_state'),
  // Solo per type:'change_state' — stato di destinazione, validato contro i
  // `states` del campo 'state' dell'entità in resolveEntityStatesAndActions.
  targetState: z
    .union([z.string(), z.null(), z.undefined()])
    .optional()
    .transform((v) => v || undefined),
  // Assente = eseguibile da chiunque abbia almeno il ruolo 'operator' (le
  // azioni sono per definizione mutazioni, mai concesse a 'viewer' anche
  // senza requiredRole esplicito — vedi enforcement lato server).
  requiredRole: z
    .union([z.enum(['admin', 'operator']), z.null(), z.undefined()])
    .optional()
    .transform((v) => v || undefined),
  // Solo per type:'trigger_webhook' (Fase 4) — URL di destinazione della
  // POST eseguita da backend/lib/action-dispatcher.js. Facoltativo: senza
  // URL l'azione viene comunque eseguita e registrata (app_action_logs), solo
  // senza consegna esterna — vedi dispatchTriggerWebhook. Solo http(s), mai
  // uno schema diverso (es. "javascript:"): un URL malformato/non http(s)
  // viene scartato qui invece di essere salvato e fallire silenziosamente ad
  // ogni esecuzione, o peggio abilitare uno schema URL pericoloso.
  // Security Audit Fase 4 (fix BLOCKER SSRF): oltre al prefisso http(s), un
  // IP letterale privato/riservato o un hostname localhost-like viene
  // scartato già qui — prima linea di difesa, non l'unica (vedi
  // isObviouslyUnsafeWebhookHost sopra per i limiti di un check senza DNS).
  webhookUrl: z
    .union([z.string(), z.null(), z.undefined()])
    .optional()
    .transform((v) => {
      const s = (v || '').trim();
      if (!/^https?:\/\//i.test(s)) return undefined;
      try {
        const hostname = new URL(s).hostname;
        if (!hostname || isObviouslyUnsafeWebhookHost(hostname)) return undefined;
      } catch {
        return undefined;
      }
      return s;
    }),
});
export type EntityAction = z.infer<typeof EntityActionSchema>;

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
  // Facoltativo: la maggior parte delle entità (anagrafiche, cataloghi) non
  // ha bisogno di azioni, solo quelle "operative" con un flusso di lavoro
  // (ordini, interventi, ticket — vedi type:'state' sopra).
  actions: z.array(EntityActionSchema).max(20).optional().default([]),
});
export type AdminEntity = z.infer<typeof AdminEntitySchema>;

export const AdminPanelSchema = z.object({
  entities: z.array(AdminEntitySchema).default([]),
});
export type AdminPanel = z.infer<typeof AdminPanelSchema>;

// ─── Relazioni 1:N (field.type === 'relation') ──────────────────────────────
// FieldSchema valida target/targetEntity/displayField solo a livello di
// singolo campo (stringhe libere): non può verificare che l'entità puntata
// esista davvero, perché durante il parse di un field non è ancora visibile
// l'intero adminPanel.entities (il field è annidato dentro l'entità che lo
// contiene). Questa risoluzione gira quindi DOPO che l'intero blueprint è
// stato parsato, con tutte le entità note — stesso principio di
// restoreDanglingEntities in app/api/creator/refactor/route.ts per le
// sezioni "list"/"form", applicato qui ai field di relazione.
function resolveEntityRelations(entities: AdminEntity[]): AdminEntity[] {
  const byName = new Map(entities.map((e) => [e.name, e]));

  return entities.map((entity) => ({
    ...entity,
    fields: entity.fields.map((field): Field => {
      if (field.type !== 'relation') return field;

      const targetName = field.targetEntity || field.target;
      const target = targetName ? byName.get(targetName) : undefined;

      if (!target) {
        // targetEntity non corrisponde a nessuna entità reale (nome
        // inventato dal modello, o entità rinominata/rimossa da un refactor
        // successivo): fallback sicuro, mai indovinare un'altra entità a
        // caso — degrada a testo libero, così il campo resta modificabile
        // invece di rompere il form/la tabella con un riferimento rotto.
        return {
          ...field,
          type: 'text',
          target: undefined,
          targetLabel: undefined,
          targetEntity: undefined,
          displayField: undefined,
        };
      }

      // displayField deve essere un campo reale dell'entità target (mai
      // 'id', che non ha un valore leggibile): altrimenti il lookup
      // mostrerebbe "undefined"/vuoto invece dell'etichetta prevista.
      const requestedDisplay = field.displayField || field.targetLabel;
      const displayIsValid = requestedDisplay
        ? target.fields.some((f) => f.id === requestedDisplay && f.type !== 'id')
        : false;
      const resolvedDisplay = displayIsValid
        ? (requestedDisplay as string)
        : (target.fields.find((f) => f.type === 'text' && f.id !== 'id')?.id
          ?? target.fields.find((f) => f.type !== 'id')?.id
          ?? 'id');

      return {
        ...field,
        target: target.name,
        targetEntity: target.name,
        targetLabel: resolvedDisplay,
        displayField: resolvedDisplay,
      };
    }),
  }));
}

// ─── Macchine a stati + azioni (field.type==='state', entity.actions) ──────
// Stesso principio di resolveEntityRelations sopra: FieldSchema/EntityActionSchema
// validano solo la forma di un singolo campo/azione isolato, non se
// riferiscono davvero a uno stato/entità reale — serve l'intera entità (per
// gli `states` del proprio campo 'state') per farlo, quindi gira dopo il
// parse completo, con lo stesso principio di fallback sicuro: mai lasciare
// un riferimento rotto, degrada invece di rompere l'UI o l'esecuzione.
function resolveEntityStatesAndActions(entities: AdminEntity[]): AdminEntity[] {
  return entities.map((entity) => {
    const fields = entity.fields.map((field): Field => {
      if (field.type !== 'state') return field;

      if (!field.states || field.states.length === 0) {
        // Nessun vocabolario di stati: non è recuperabile (a differenza di
        // una relazione, non c'è "un'altra entità" su cui ripiegare), degrada
        // a testo libero — il campo resta modificabile invece di sparire.
        return { ...field, type: 'text', states: undefined, allowedTransitions: undefined };
      }

      if (!field.allowedTransitions) return field; // assente = tutte le transizioni ammesse (vedi normalizeField)

      const validStates = new Set(field.states);
      const filtered: Record<string, string[]> = {};
      for (const [from, tos] of Object.entries(field.allowedTransitions)) {
        if (!validStates.has(from)) continue; // stato di partenza inesistente: riga scartata
        const validTos = tos.filter((to) => validStates.has(to));
        if (validTos.length > 0) filtered[from] = validTos;
      }
      return { ...field, allowedTransitions: Object.keys(filtered).length > 0 ? filtered : undefined };
    });

    // Prima entità con un campo 'state' vince come "stato di riferimento"
    // delle sue azioni change_state — l'azione non porta un riferimento a un
    // field id specifico (vedi EntityActionSchema), assunzione documentata:
    // un'entità operativa ha un solo campo di stato "principale".
    const stateField = fields.find((f) => f.type === 'state');
    const actions = entity.actions.filter((action) => {
      if (action.type !== 'change_state') return true;
      if (!stateField?.states || !action.targetState) return false;
      // Nessun'azione punta a uno stato inesistente: eseguirla fallirebbe
      // sempre lato server (vedi POST .../actions/:actionId), meglio non
      // mostrare mai il pulsante che mostrarlo e farlo fallire ogni volta.
      return stateField.states.includes(action.targetState);
    });

    return { ...entity, fields, actions };
  });
}

// Punto unico richiamato da sanitizeSiteBlueprint per entrambi i percorsi
// (parse Zod riuscito / recupero manuale): relazioni prima, stati/azioni
// dopo — le azioni change_state dipendono dai `states` già risolti (un
// campo 'state' senza vocabolario valido è già stato degradato a testo
// quando resolveEntityStatesAndActions filtra le sue azioni).
function resolveEntities(entities: AdminEntity[]): AdminEntity[] {
  return resolveEntityStatesAndActions(resolveEntityRelations(entities));
}

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
  // Facoltativo: assente = { enabled:false, ... } (default di AuthConfigSchema),
  // stesso comportamento di sempre (auth_mode 'legacy', vedi publish/route.ts).
  authConfig: AuthConfigSchema.optional().default({ enabled: false, supportedRoles: ['admin'], defaultRole: 'viewer' }),
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
    if (result.pages.length > 0) {
      return { ...result, adminPanel: { entities: resolveEntities(result.adminPanel.entities) } };
    }
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

  // authConfig: stesso trattamento "prova il parse stretto, altrimenti
  // fallback ai default sicuri (disabilitato)" del resto di questa funzione
  // di recupero manuale — non è mai questo il percorso che decide se un'app
  // finisce in modalità rbac (serve comunque superare il parse Zod sopra),
  // ma un default coerente evita un `authConfig` mancante/malformato qui.
  const authConfigParse = AuthConfigSchema.safeParse(r.authConfig);
  const authConfig: AuthConfig = authConfigParse.success
    ? authConfigParse.data
    : { enabled: false, supportedRoles: ['admin'], defaultRole: 'viewer' };

  return {
    projectType: (['landing', 'webapp-pwa', 'ecommerce'] as const).includes(r.projectType) ? r.projectType : 'landing',
    appName: safeStr(r.appName ?? r.name, 'Il Mio Sito'),
    sector: safeStr(r.sector, 'custom'),
    description: safeStr(r.description),
    businessConfig,
    adminPanel: { entities: resolveEntities(entities) },
    authConfig,
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
