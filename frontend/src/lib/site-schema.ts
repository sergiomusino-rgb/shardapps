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
// Estensione esplicita (Fase 1, stesso motivo di app-specification.ts,
// tsconfig.json::allowImportingTsExtensions): permette a questo modulo di
// essere eseguito anche direttamente da `node --test` (necessario per
// site-schema.test.ts) — Next.js/webpack risolve un import relativo con o
// senza estensione .ts in modo identico, nessun cambio di comportamento a
// runtime nell'app.
import { FieldSchema, DashboardCardSchema, type Field, type DashboardCard } from './blueprint-schema.ts';

// ─── Tipo progetto ──────────────────────────────────────────────────────────

// CreatorAI Engine 2.0, Fase 1: 'gestionale' recupera la capacità
// sector-agnostic del vecchio motore v1 (blueprint-engine.ts) dentro questo
// stesso motore — vedi projectTypeGuide in app/api/creator/generate/route.ts
// per la guida di generazione libera da vincoli di settore. Nessun altro
// projectType cambia significato/comportamento.
export const ProjectTypeSchema = z.enum(['landing', 'webapp-pwa', 'ecommerce', 'gestionale']);
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
  {
    value: 'gestionale',
    label: 'Gestionale',
    description: 'CRM, helpdesk, project management, gestione immobili o qualunque altro dominio: tu descrivi, l\'AI progetta le entità.',
    icon: '🗂️',
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
// Estratto da EntityActionSchema.webhookUrl (Fase 4, Workflow Engine): stessa
// identica validazione, riusata ora anche da WorkflowActionSchema.webhookUrl
// più sotto — un solo punto di verità invece di due copie della stessa
// logica di prima linea di difesa SSRF (vedi isObviouslyUnsafeWebhookHost
// sopra per i limiti di un check senza DNS; la barriera autoritativa resta
// backend/lib/ssrf-guard.js, invocata ad ogni esecuzione).
const WebhookUrlFieldSchema = z
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
  });

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
  webhookUrl: WebhookUrlFieldSchema,
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

// ─── dashboardCards (Quality Pass v1, Fix #3) ───────────────────────────────
// Stesso principio di resolveEntityRelations/resolveEntityStatesAndActions
// sopra: DashboardCardSchema valida solo la FORMA di una card isolata, non se
// "table"/"field" riferiscono davvero un'entità/campo reali — serve
// l'adminPanel.entities già risolto per verificarlo. Una card con un
// riferimento rotto viene scartata (mai mostrata, mai un crash a runtime nel
// Dashboard che dovrebbe calcolarla), non "riparata a caso": è l'unico modo
// sicuro di gestire un riferimento che l'AI può comunque generare male.
const DASHBOARD_CARD_TYPES = new Set(['count', 'sum', 'avg', 'latest']);
function resolveDashboardCards(entities: AdminEntity[], cards: DashboardCard[]): DashboardCard[] {
  const byName = new Map(entities.map((e) => [e.name, e]));
  const out: DashboardCard[] = [];
  for (const card of cards) {
    const entity = byName.get(card.table);
    if (!entity) continue; // "table" non corrisponde a nessuna entità reale: scartata, mai una card che il Dashboard non può calcolare
    const type = DASHBOARD_CARD_TYPES.has(card.type) ? card.type : 'count';
    if ((type === 'sum' || type === 'avg') && !entity.fields.some((f) => f.id === card.field && (f.type === 'number' || f.type === 'currency'))) {
      continue; // sum/avg richiede un campo numerico REALE dell'entità: senza, non è calcolabile
    }
    out.push({ ...card, type });
  }
  return out.slice(0, 6); // stesso tetto del prompt (WORKFLOW_DOC-style): una dashboard con troppe card è rumore, non chiarezza
}

// ─── Landing di fallback, generica ma coerente col dominio (Quality Pass v1,
// Fix #1) ─────────────────────────────────────────────────────────────────
// Nessuna chiamata AI: costruita SOLO da dati già presenti nel blueprint
// (businessConfig, nomi/etichette delle entità) — mai un testo hardcoded
// identico per ogni app, mai inventato da zero. Usata sia da
// creator-site-generator.ts (quando il modello non produce sezioni
// nonostante l'istruzione nel prompt) sia, come ultima rete di sicurezza,
// dal renderer pubblico (SitePreview.tsx) per i blueprint già pubblicati
// prima di questa fase con `sections: []` salvato in DB.
export function buildFallbackLandingSections(
  businessConfig: BusinessConfig,
  entities: AdminEntity[]
): PageSection[] {
  const name = businessConfig.name?.trim() || 'La Mia Attività';
  const tagline = businessConfig.tagline?.trim() || '';
  const description = businessConfig.description?.trim()
    || (entities.length > 0
      ? `${name} gestisce ${entities.slice(0, 4).map((e) => e.labelPlural || e.label).join(', ')} in un unico pannello, sempre aggiornato.`
      : `${name} è gestito con ShardApps.`);

  // Stringa vuota, non `undefined`: i campi facoltativi delle sezioni
  // (subtitle/imageUrl/ctaHref/buttonHref) sono tipati "string" dopo il
  // parse Zod (str(), site-schema.ts sotto — fallback sempre a '', mai a
  // undefined), stesso identico contratto dei campi generati dal modello.
  const sections: PageSection[] = [
    {
      type: 'hero',
      title: tagline || name,
      subtitle: tagline ? name : '',
      imageUrl: businessConfig.heroImageUrl || '',
      ctaLabel: 'Accedi',
      ctaHref: '',
    },
  ];

  if (entities.length > 0) {
    sections.push({
      type: 'about',
      title: 'Cosa gestiamo',
      body: description,
      imageUrl: '',
    });
  }

  sections.push({
    type: 'cta',
    title: 'Vuoi saperne di più?',
    subtitle: '',
    buttonLabel: 'Contattaci',
    buttonHref: '',
  });

  return sections;
}

/**
 * Garantisce che ogni pagina abbia almeno una sezione, sostituendo un array
 * `sections` vuoto con la landing di fallback sopra — mai lasciando
 * "Questa pagina non ha ancora sezioni" su un'app appena generata. Applicata
 * SOLO alle pagine effettivamente vuote: una pagina con contenuto reale
 * (anche parziale) non viene mai toccata.
 */
export function ensurePagesHaveSections(
  pages: SitePage[],
  businessConfig: BusinessConfig,
  entities: AdminEntity[]
): SitePage[] {
  if (pages.every((p) => p.sections.length > 0)) return pages; // percorso comune: nessuna modifica, stessa identità di riferimento
  const fallback = buildFallbackLandingSections(businessConfig, entities);
  return pages.map((p) => (p.sections.length > 0 ? p : { ...p, sections: fallback }));
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

// Esportata (Fase 3 — Component Registry, frontend/src/lib/creator/component-registry.ts):
// unica fonte di verità per "quali 9 type esistono oggi", riusata da
// frontend/src/components/creator/sections/index.tsx per registrare le entry
// predefinite del Registry senza duplicare l'elenco — comportamento di questo
// modulo invariato, solo una `const` che diventa `export const`.
export const KNOWN_SECTION_TYPES: PageSectionType[] = [
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

// ─── workflows (CreatorAI Engine 2.0, Fase 4 — Application Logic/Workflow
// Engine) ─────────────────────────────────────────────────────────────────
// Modello EVENT -> TRIGGER -> CONDITION -> ACTION eseguito lato server da
// backend/lib/event-router.js (condizioni valutate da
// backend/lib/condition-evaluator.js, azioni eseguite da
// backend/lib/workflow-action-executor.js — trigger_webhook/send_notification
// sempre delegate a backend/lib/action-dispatcher.js, mai duplicate).
// Campo top-level opzionale (default []): un'app senza workflows si comporta
// esattamente come prima di questa fase, nessuna migrazione richiesta.

export const WorkflowTriggerEventSchema = z.enum([
  'record.created', 'record.updated', 'record.deleted',
  'state.changed', 'user.action', 'schedule.tick', 'webhook.received',
]);
export type WorkflowTriggerEvent = z.infer<typeof WorkflowTriggerEventSchema>;

export const WorkflowTriggerSchema = z.object({
  event: WorkflowTriggerEventSchema,
  // Nome dell'entità (adminPanel.entities[].name / schema.tables[].name /
  // custom table) a cui il trigger si applica — facoltativo per
  // 'schedule.tick' (un tick "a vuoto", senza contesto di record, vedi
  // backend/jobs/workflow-schedule.js), richiesto di fatto per tutti gli
  // altri eventi (un trigger senza entity su record.created/state.changed/
  // ecc. semplicemente non troverà mai una corrispondenza, il router non lo
  // vieta esplicitamente ma non ha alcun effetto).
  entity: z.union([z.string(), z.null(), z.undefined()]).optional().transform((v) => v || undefined),
  // Solo per 'user.action': id dell'azione (adminPanel.entities[].actions[].id)
  // che ha innescato l'evento — assente = il trigger reagisce a QUALUNQUE
  // azione dell'entità.
  actionId: z.union([z.string(), z.null(), z.undefined()]).optional().transform((v) => v || undefined),
  // Solo per 'state.changed': stato di destinazione/partenza a cui reagire —
  // entrambi assenti = il trigger reagisce a QUALUNQUE cambio di stato.
  toState: z.union([z.string(), z.null(), z.undefined()]).optional().transform((v) => v || undefined),
  fromState: z.union([z.string(), z.null(), z.undefined()]).optional().transform((v) => v || undefined),
});
export type WorkflowTrigger = z.infer<typeof WorkflowTriggerSchema>;

// ─── conditions (albero AND/OR ricorsivo) ───────────────────────────────────
// NESSUN eval()/codice arbitrario: `operator` di una foglia è un vocabolario
// chiuso confrontato da backend/lib/condition-evaluator.js, mai eseguito.
export const ConditionOperatorSchema = z.enum([
  'equals', 'not_equals', 'contains', 'not_contains',
  'greater_than', 'less_than', 'greater_or_equal', 'less_or_equal',
  'exists', 'not_exists',
]);
export type ConditionOperator = z.infer<typeof ConditionOperatorSchema>;

// value: solo primitivi (compatibili con Json/apps.config e con
// getFieldValue in backend/lib/condition-evaluator.js, che confronta sempre
// via String()/Number() — un oggetto/array come termine di paragone non
// avrebbe comunque un confronto sensato con nessuno dei 10 operatori).
export type ConditionValue = string | number | boolean | null;

export type ConditionNode =
  | { field: string; operator: ConditionOperator; value?: ConditionValue }
  | { operator: 'AND' | 'OR'; conditions: ConditionNode[] };

// z.lazy per il riferimento ricorsivo (un gruppo contiene altri nodi dello
// stesso tipo) — z.ZodType<ConditionNode> esplicito perché Zod non può
// inferire da solo un tipo ricorsivo definito con z.lazy.
export const ConditionNodeSchema: z.ZodType<ConditionNode> = z.lazy(() =>
  z.union([
    z.object({ field: z.string(), operator: ConditionOperatorSchema, value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional() }),
    z.object({ operator: z.enum(['AND', 'OR']), conditions: z.array(ConditionNodeSchema) }),
  ])
);

// ─── workflow actions ────────────────────────────────────────────────────────
// change_state/trigger_webhook/send_notification: stessi 3 tipi di
// EntityActionSchema sopra (compatibilità Fase 3, invariati). update_field/
// create_related_record: nuovi in questa fase, eseguiti SOLO da un workflow
// (nessun pulsante utente diretto li innesca).
export const WorkflowActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('change_state'), targetState: z.string() }),
  z.object({ type: z.literal('trigger_webhook'), webhookUrl: WebhookUrlFieldSchema }),
  z.object({
    type: z.literal('send_notification'),
    // 'app_owner' (default): notifica il titolare dell'app (apps.client_email).
    // 'record_field': notifica l'indirizzo email nel campo `recipientField`
    // del record che ha innescato l'evento (es. il cliente di un ordine).
    recipient: z.enum(['app_owner', 'record_field']).catch('app_owner'),
    recipientField: z.union([z.string(), z.null(), z.undefined()]).optional().transform((v) => v || undefined),
    subject: z.union([z.string(), z.null(), z.undefined()]).optional().transform((v) => v || undefined),
    message: z.union([z.string(), z.null(), z.undefined()]).optional().transform((v) => v || undefined),
  }),
  // value: solo primitivi compatibili con app_records.data (JSONB) — un
  // update_field scrive sempre un valore scalare in un campo, mai un oggetto/
  // array arbitrario (che richiederebbe di conoscere la forma del campo
  // target, fuori scope di questa fase).
  z.object({ type: z.literal('update_field'), field: z.string(), value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional() }),
  z.object({
    type: z.literal('create_related_record'),
    targetEntity: z.string(),
    // Mappa { campo_entità_target: campo_record_sorgente } — valorizzata dal
    // valore del record che ha innescato l'evento, vedi
    // backend/lib/workflow-action-executor.js::executeCreateRelatedRecord.
    fieldMapping: z.record(z.string(), z.string()).optional().default({}),
  }),
  // http_request (Integrations — Pre-Beta Hardening Round 2): azione HTTP
  // generica, a differenza di trigger_webhook (sempre POST, payload fisso
  // standard). Stessa barriera di sicurezza di trigger_webhook (SSRF guard
  // ad ogni tentativo, mai solo al salvataggio — vedi WebhookUrlFieldSchema
  // sopra): la validazione qui è solo la prima linea di difesa. headers è
  // una whitelist libera (es. Authorization verso un servizio esterno) ma
  // MAI Host/Content-Length/Content-Type, forzati dal dispatcher — vedi
  // backend/lib/action-dispatcher.js::sanitizeHttpActionHeaders.
  z.object({
    type: z.literal('http_request'),
    url: WebhookUrlFieldSchema,
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).catch('POST'),
    headers: z.record(z.string(), z.string()).optional().default({}),
    body: z.union([z.string(), z.null(), z.undefined()]).optional().transform((v) => v || undefined),
  }),
]);
export type WorkflowAction = z.infer<typeof WorkflowActionSchema>;

export const WorkflowSchema = z.object({
  id: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).replace(/[^a-z0-9_]/gi, '_').toLowerCase())
    .default('workflow'),
  name: z.union([z.string(), z.number()]).transform((v) => String(v)).default('Workflow'),
  enabled: z.union([z.boolean(), z.string()]).optional().transform((v) => v !== false && v !== 'false').default(true),
  trigger: WorkflowTriggerSchema,
  // Facoltative: assenti = il workflow esegue sempre le sue azioni quando il
  // trigger scatta (vedi evaluateCondition in backend/lib/condition-evaluator.js).
  conditions: ConditionNodeSchema.optional(),
  actions: z.array(WorkflowActionSchema).min(1).max(20),
});
export type Workflow = z.infer<typeof WorkflowSchema>;

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
  // Facoltativo: assente = [] (Fase 4, Logic/Workflow Engine) — un'app senza
  // workflows si comporta esattamente come prima di questa fase.
  workflows: z.array(WorkflowSchema).optional().default([]),
  // Quality Pass v1 (Fix #3 — dashboard di dominio): riusa DashboardCardSchema
  // di blueprint-schema.ts COSÌ COM'È, stesso principio del riuso di
  // FieldSchema in questo stesso file — nessun secondo sistema di dashboard,
  // solo lo stesso contratto {type, table, label, field?, filter?} del motore
  // v1 (finora mai popolato per il v2, vedi app-specification.ts) ora
  // valorizzabile anche qui. Facoltativo, default []: un blueprint esistente
  // senza questo campo si comporta esattamente come prima (dashboard
  // generica invariata in app/a/[slug]/app/page.tsx).
  dashboardCards: z.array(DashboardCardSchema).optional().default([]),
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
      const entities = resolveEntities(result.adminPanel.entities);
      return {
        ...result,
        adminPanel: { entities },
        pages: ensurePagesHaveSections(result.pages, result.businessConfig, entities),
        dashboardCards: resolveDashboardCards(entities, result.dashboardCards),
      };
    }
  } catch {
    // fall through al recupero manuale
  }

  const r = raw as Record<string, any>;
  // Prima non teneva una pagina con "sections" vuoto (filtro qui sotto):
  // per 'gestionale' questo era il caso NORMALE (una sola pagina "home",
  // sections:[]), non un errore da scartare — ora si tiene la pagina e la si
  // riempie più sotto via ensurePagesHaveSections, coerente col percorso di
  // parse stretto sopra. Resta un rifiuto (null) solo se non c'è proprio
  // nessuna pagina recuperabile (nessun array "pages" utilizzabile).
  const pages = Array.isArray(r.pages) ? r.pages.map(normalizePage) : [];
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

  // workflows (Fase 4): stesso trattamento "prova il parse stretto per ogni
  // elemento, scarta solo quelli malformati" — un workflow scritto male non
  // deve far sparire l'intero blueprint recuperato qui, solo se stesso.
  const workflowsRaw = Array.isArray(r.workflows) ? r.workflows : [];
  const workflows: Workflow[] = workflowsRaw
    .map((w: unknown) => WorkflowSchema.safeParse(w))
    .filter((res: ReturnType<typeof WorkflowSchema.safeParse>): res is { success: true; data: Workflow } => res.success)
    .map((res) => res.data);

  // Stesso trattamento di workflows: prova il parse stretto per ogni
  // elemento, scarta solo quelli malformati. resolveDashboardCards (già
  // usata nel percorso di parse stretto sopra) applica poi lo stesso
  // filtro semantico (tabella/campo esistenti, cap a 6 card) qui.
  const resolvedEntities = resolveEntities(entities);
  const dashboardCardsRaw = Array.isArray(r.dashboardCards) ? r.dashboardCards : [];
  const dashboardCards: DashboardCard[] = resolveDashboardCards(
    resolvedEntities,
    dashboardCardsRaw
      .map((c: unknown) => DashboardCardSchema.safeParse(c))
      .filter((res: ReturnType<typeof DashboardCardSchema.safeParse>): res is { success: true; data: DashboardCard } => res.success)
      .map((res) => res.data)
  );

  return {
    // Stesso vocabolario di ProjectTypeSchema sopra (Fase 1, CreatorAI Engine
    // 2.0): questo array era rimasto hardcoded a parte, un gestionale che
    // fosse caduto in questo percorso di recupero manuale sarebbe stato
    // silenziosamente riscritto a 'landing' senza questo fix.
    projectType: (['landing', 'webapp-pwa', 'ecommerce', 'gestionale'] as const).includes(r.projectType) ? r.projectType : 'landing',
    appName: safeStr(r.appName ?? r.name, 'Il Mio Sito'),
    sector: safeStr(r.sector, 'custom'),
    description: safeStr(r.description),
    businessConfig,
    adminPanel: { entities: resolvedEntities },
    authConfig,
    // Stesso fix del percorso di parse stretto sopra: una pagina con
    // "sections" vuoto (il caso normale per 'gestionale') non deve arrivare
    // vuota al renderer — ensurePagesHaveSections ci mette una landing di
    // fallback deterministica, senza toccare le pagine che hanno già
    // contenuto reale.
    pages: ensurePagesHaveSections(pages, businessConfig, resolvedEntities),
    actionButtons,
    workflows,
    dashboardCards,
    ui: {
      primaryColor: primaryColor.startsWith('#') ? primaryColor : `#${primaryColor}`,
      secondaryColor: uiRaw.secondaryColor ? safeStr(uiRaw.secondaryColor) : undefined,
      font: safeStr(uiRaw.font, 'Inter'),
    },
  };
}

// ─── Euristica "prompt menziona uno stato ma lo schema non ne ha uno" ───────
// Product Readiness Audit (P2 — qualità percepita): osservato empiricamente
// che un prompt esplicito ("campo di stato con soli 2 valori") non sempre
// produce un campo type:'state' al primo tentativo dell'AI. Nessuna chiamata
// AI aggiuntiva, nessun retry automatico (scelta deliberata: un retry
// raddoppierebbe costo/latenza per un controllo puramente euristico, con
// falsi positivi possibili) — solo un confronto testuale che permette
// all'editor di mostrare un avviso non bloccante, lasciando all'utente la
// scelta se chiedere di nuovo al Copilot.
//
// Parole chiave multilingua (i 5 locale del wizard, vedi ProjectWizard.tsx):
// elenco volutamente non esaustivo — falsi negativi (un prompt che descrive
// uno stato senza usare nessuna di queste parole) sono accettabili per
// un'euristica informativa, un falso positivo qui è solo un avviso in più da
// poter ignorare, mai un blocco.
const STATE_KEYWORDS = [
  // it
  'stato', 'workflow', 'flusso di lavoro', 'transizione', 'transizioni', 'cambio stato',
  // en
  'state', 'status', 'transition', 'flow',
  // de
  'zustand', 'arbeitsablauf', 'übergang',
  // fr
  'statut', 'état', 'flux de travail',
  // es
  'estado', 'flujo de trabajo', 'transición',
];

function schemaHasStateField(schema: SiteBlueprintJSON): boolean {
  return schema.adminPanel.entities.some((entity) => entity.fields.some((f) => f.type === 'state'));
}

/**
 * true quando il testo dell'utente (prompt iniziale o istruzione Copilot)
 * sembra descrivere uno stato/workflow ma lo schema risultante non contiene
 * alcun campo `type:'state'` in nessuna entità — segnale da mostrare come
 * avviso non bloccante nell'editor, mai per rifiutare/bloccare il risultato.
 */
export function promptSuggestsStateButMissing(promptText: string, schema: SiteBlueprintJSON): boolean {
  if (!promptText || schemaHasStateField(schema)) return false;
  const haystack = promptText.toLowerCase();
  return STATE_KEYWORDS.some((kw) => haystack.includes(kw));
}

export type { Field };
