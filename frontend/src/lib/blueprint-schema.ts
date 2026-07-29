import { z } from 'zod';

// Accetta qualsiasi tipo di campo e lo normalizza
const FieldTypeSchema = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).toLowerCase().trim());

function normalizeFieldType(type: string): string {
  const mapping: Record<string, string> = {
    string: 'text',
    varchar: 'text',
    char: 'text',
    text: 'text',
    integer: 'number',
    int: 'number',
    bigint: 'number',
    decimal: 'number',
    float: 'number',
    double: 'number',
    numeric: 'number',
    timestamp: 'datetime',
    timestamptz: 'datetime',
    date: 'date',
    datetime: 'datetime',
    jsonb: 'text',
    json: 'text',
    boolean: 'boolean',
    bool: 'boolean',
    email: 'email',
    phone: 'phone',
    textarea: 'textarea',
    select: 'select',
    multiselect: 'multiselect',
    relation: 'relation',
    currency: 'currency',
    file: 'file',
    image: 'image',
  };
  return mapping[type] || 'text';
}

// L'AI a volte etichetta un campo prezzo come "text" nonostante il prompt
// richieda esplicitamente "number" — questo fa sì che renderCellValue non lo
// formatti mai come valuta. Forziamo qui il tipo in base al nome/label, invece
// di fidarci ciecamente dell'output del modello.
const PRICE_FIELD_KEYWORDS = [
  'prezzo', 'totale', 'importo', 'costo', 'subtotale', 'imponibile',
  'tariffa', 'canone', 'price', 'amount', 'cost', 'total', 'fee',
];

function looksLikePriceField(id: string, label: string): boolean {
  const haystack = `${id} ${label}`.toLowerCase();
  return PRICE_FIELD_KEYWORDS.some((k) => haystack.includes(k));
}

function withPriceFieldOverride<T extends { id: string; label: string; type: string }>(field: T): T {
  if (field.type === 'text' && looksLikePriceField(field.id, field.label)) {
    return { ...field, type: 'number' };
  }
  return field;
}

const FieldOptionsSchema = z
  .union([
    z.array(z.string()),
    z.array(z.any()).transform((arr) => arr.map((o: any) => (typeof o === 'string' ? o : o?.label || o?.value || String(o))).filter(Boolean)),
    z.record(z.string(), z.string()).transform((rec) => Object.values(rec)),
    z.record(z.string(), z.any()).transform((rec) => Object.values(rec).map((v: any) => String(v))),
    z.null(),
  ])
  .optional()
  .default([]);

export const FieldSchema = z.object({
  id: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).replace(/[^a-z0-9_]/gi, '_').toLowerCase())
    .default('campo'),
  type: FieldTypeSchema.transform(normalizeFieldType),
  label: z.union([z.string(), z.number()]).transform((v) => String(v)).default('Campo'),
  required: z.union([z.boolean(), z.string(), z.number()]).transform((v) => v === true || v === 'true' || v === 1).default(false),
  options: FieldOptionsSchema,
  target: z
    .union([z.string(), z.null(), z.undefined()])
    .optional()
    .transform((v) => v || undefined),
  targetLabel: z
    .union([z.string(), z.null(), z.undefined()])
    .optional()
    .transform((v) => v || undefined),
}).transform(withPriceFieldOverride);

export const TableSchema = z.object({
  name: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).replace(/[^a-z0-9_]/gi, '_').toLowerCase())
    .default('tabella'),
  label: z.union([z.string(), z.number()]).transform((v) => String(v)).default('Tabella'),
  labelPlural: z.union([z.string(), z.number()]).transform((v) => String(v)).default('Tabelle'),
  fields: z.array(FieldSchema).min(1).max(50),
  icon: z.union([z.string(), z.number()]).transform((v) => String(v)).optional().default(''),
});

export const DashboardCardSchema = z.object({
  type: z
    .union([z.string(), z.number(), z.null()])
    .transform((v) => (v == null ? 'count' : String(v)))
    .default('count'),
  table: z
    .union([z.string(), z.number(), z.null()])
    .transform((v) => (v == null ? '' : String(v)))
    .default(''),
  label: z
    .union([z.string(), z.number(), z.null()])
    .transform((v) => (v == null ? '' : String(v)))
    .default(''),
  field: z
    .union([z.string(), z.number(), z.null()])
    .transform((v) => (v == null ? '' : String(v)))
    .optional()
    .default(''),
  filter: z.record(z.string(), z.any()).optional(),
});

const SidebarItemSchema = z.union([
  z.string(),
  z.object({ name: z.string() }).transform((o) => o.name),
  z.object({ id: z.string() }).transform((o) => o.id),
  z.any().transform((v) => String(v)),
]);

export const UIConfigSchema = z.object({
  primaryColor: z
    .union([
      z.string().regex(/^#([0-9A-Fa-f]{6})$/),
      z.string().transform((v) => (v?.startsWith('#') ? v : `#${v}`)),
      z.string().default('#6366f1'),
    ])
    .default('#6366f1'),
sidebar: z.union([
    z.array(SidebarItemSchema),
    z.boolean().transform(() => []),
    z.record(z.string(), z.any()).transform((obj) => Object.keys(obj)),
    z.any().transform(() => []),
  ]).default([]),
dashboardCards: z.union([
    z.array(DashboardCardSchema),
    z.record(z.string(), z.unknown()).transform((obj) => Object.values(obj).map((v: unknown) => {
      if (typeof v === 'object' && v !== null) {
        const entry = v as Record<string, unknown>;
        return {
          type: String(entry.type || 'count'),
          table: String(entry.table || ''),
          label: String(entry.label || ''),
          field: String(entry.field || ''),
        };
      }
      return { type: 'count', table: '', label: '', field: '' };
    })),
    z.object({}).transform(() => []),
  ]).default([]),
});

export const BlueprintJSONSchema = z.object({
  appName: z.union([z.string(), z.number()]).transform((v) => String(v)).default('Nuova App'),
  sector: z.union([z.string(), z.number()]).transform((v) => String(v)).default('custom'),
  description: z.union([z.string(), z.number()]).transform((v) => String(v)).optional().default(''),
  logo: z.union([z.string(), z.number()]).transform((v) => String(v)).optional().default(''),
  schema: z.object({
    tables: z.array(TableSchema).min(0).max(50).default([]),
  }).default({ tables: [] }),
  ui: UIConfigSchema,
});

export type Field = z.infer<typeof FieldSchema>;
export type Table = z.infer<typeof TableSchema>;
export type DashboardCard = z.infer<typeof DashboardCardSchema>;
export type UIConfig = z.infer<typeof UIConfigSchema>;
export type BlueprintJSON = z.infer<typeof BlueprintJSONSchema>;

// ─── Tabelle di sistema obbligatorie ────────────────────────────────────────
// Ogni app generata deve SEMPRE includere questi dati anagrafici/fiscali di
// base, a prescindere dal settore: senza questi campi (P.IVA, IBAN, fatture,
// stato pagamento...) il cliente finale non ha modo di gestire i dati fiscali
// della propria attività. L'AI di settore genera solo le tabelle di dominio
// (pazienti, ordini, ...); queste due vengono iniettate sempre in coda.
function coreField(f: { id: string; type: string; label: string; required?: boolean; options?: string[] }): Field {
  return { required: false, options: [], target: undefined, targetLabel: undefined, ...f };
}

const CORE_TABLE_DATI_AZIENDALI: Table = {
  name: 'dati_aziendali',
  label: 'Dato Aziendale',
  labelPlural: 'Dati Azienda',
  icon: '🏢',
  fields: [
    coreField({ id: 'ragione_sociale', type: 'text', label: 'Ragione Sociale', required: true }),
    coreField({ id: 'partita_iva', type: 'text', label: 'P.IVA' }),
    coreField({ id: 'codice_fiscale', type: 'text', label: 'Codice Fiscale' }),
    coreField({ id: 'indirizzo', type: 'text', label: 'Indirizzo' }),
    coreField({ id: 'email_pec_sdi', type: 'text', label: 'Email PEC / Codice SDI' }),
    coreField({ id: 'telefono', type: 'phone', label: 'Telefono' }),
    coreField({ id: 'iban', type: 'text', label: 'IBAN' }),
    coreField({ id: 'logo', type: 'image', label: 'Logo' }),
  ],
};

const CORE_TABLE_FATTURE: Table = {
  name: 'fatture',
  label: 'Fattura',
  labelPlural: 'Fatture',
  icon: '🧾',
  fields: [
    coreField({ id: 'numero_documento', type: 'text', label: 'Numero Documento', required: true }),
    coreField({ id: 'data', type: 'date', label: 'Data', required: true }),
    coreField({ id: 'cliente', type: 'text', label: 'Cliente', required: true }),
    coreField({ id: 'importo_totale', type: 'currency', label: 'Importo Totale', required: true }),
    coreField({ id: 'iva', type: 'number', label: 'IVA (%)' }),
    coreField({ id: 'stato_pagamento', type: 'select', label: 'Stato Pagamento', options: ['Pagata', 'In attesa', 'Scaduta', 'Annullata'] }),
    coreField({ id: 'link_pdf', type: 'text', label: 'Link PDF/Stampa' }),
  ],
};

// Nomi/alias che, se già presenti nello schema generato dall'AI, evitano la
// doppia iniezione della relativa tabella di sistema.
const DATI_AZIENDALI_ALIASES = new Set(['dati_aziendali', 'impostazioni_azienda']);
const FATTURE_ALIASES = new Set(['fatture', 'documenti']);

export function ensureCoreSystemTables(tables: Table[]): Table[] {
  const existingNames = new Set(tables.map((t) => t.name));
  const result = [...tables];

  if (![...DATI_AZIENDALI_ALIASES].some((alias) => existingNames.has(alias))) {
    result.push(CORE_TABLE_DATI_AZIENDALI);
  }
  if (![...FATTURE_ALIASES].some((alias) => existingNames.has(alias))) {
    result.push(CORE_TABLE_FATTURE);
  }

  return result;
}

function safeString(v: unknown, fallback = ''): string {
  if (v == null) return fallback;
  return String(v);
}

function safeNormalizeId(v: unknown, fallback = 'campo'): string {
  if (v == null) return fallback;
  return String(v).replace(/[^a-z0-9_]/gi, '_').toLowerCase() || fallback;
}

function safeNormalizeFieldType(type: unknown): string {
  const t = safeString(type, 'text').toLowerCase().trim();
  return normalizeFieldType(t);
}

function normalizeField(raw: any): Field {
  return withPriceFieldOverride({
    id: safeNormalizeId(raw?.id ?? raw?.name ?? raw?.key, 'campo'),
    type: safeNormalizeFieldType(raw?.type),
    label: safeString(raw?.label ?? raw?.title ?? raw?.name, 'Campo'),
    required: raw?.required === true || raw?.required === 'true' || raw?.required === 1,
    options: normalizeOptions(raw?.options),
    target: raw?.target || undefined,
    targetLabel: raw?.targetLabel || undefined,
  });
}

function normalizeOptions(v: unknown): string[] {
  if (v == null || v === false) return [];
  if (Array.isArray(v)) {
    return v.map((o: any) => {
      if (typeof o === 'string') return o;
      if (o && typeof o === 'object') return safeString(o?.label ?? o?.value ?? o?.name ?? o, '');
      return String(o);
    }).filter(Boolean);
  }
  if (typeof v === 'object') {
    return Object.values(v as Record<string, unknown>).map((val) => {
      if (typeof val === 'string') return val;
      if (val && typeof val === 'object') return safeString((val as any)?.label ?? (val as any)?.value ?? val, '');
      return String(val);
    }).filter(Boolean);
  }
  return [];
}

function normalizeTable(raw: any): Table {
  const fields = Array.isArray(raw?.fields)
    ? raw.fields.map(normalizeField).filter((f: Field) => f.id && f.type)
    : [];
  // Se non ci sono campi validi, aggiungi un campo di fallback
  if (fields.length === 0) {
    fields.push({ id: 'nome', type: 'text', label: 'Nome', required: false, options: [] });
  }
  return {
    name: safeNormalizeId(raw?.name ?? raw?.id ?? raw?.table ?? 'tabella', 'tabella'),
    label: safeString(raw?.label ?? raw?.title ?? raw?.name, 'Tabella'),
    labelPlural: safeString(raw?.labelPlural ?? raw?.label_plural ?? raw?.plural ?? raw?.label + 's', safeString(raw?.label ?? 'Tabelle')),
    fields,
    icon: safeString(raw?.icon, ''),
  };
}

function extractTables(raw: any): Table[] {
  // Cerca tabelle in vari path possibili
  const candidates = [
    raw?.schema?.tables,
    raw?.tables,
    raw?.data?.tables,
    raw?.blueprint?.schema?.tables,
    raw?.blueprint?.tables,
    raw?.config?.schema?.tables,
    raw?.config?.tables,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate.map(normalizeTable);
    }
  }
  return [];
}

export function sanitizeBlueprint(raw: unknown): BlueprintJSON | null {
  if (!raw || typeof raw !== 'object') {
    console.warn('[sanitizeBlueprint] raw is not an object:', raw);
    return null;
  }

  const r = raw as Record<string, any>;

  // Try Zod parse first
  try {
    const result = BlueprintJSONSchema.parse(raw);
    if (result.schema.tables.length > 0) {
      return { ...result, schema: { tables: ensureCoreSystemTables(result.schema.tables) } };
    }
  } catch (e) {
    console.warn('[sanitizeBlueprint] Zod parse failed, doing manual extraction:', (e as any)?.message?.slice(0, 200));
  }

  // Manual extraction fallback
  try {
    const appName = safeString(r.appName ?? r.name ?? r.app_name ?? r.title, 'Nuova App');
    const sector = safeString(r.sector ?? r.settore, 'custom');
    const description = safeString(r.description ?? r.descrizione, '');
    const logo = safeString(r.logo, '');
    const tables = ensureCoreSystemTables(extractTables(r));

    // UI
    const uiRaw = r.ui ?? {};
    const primaryColor = safeString(uiRaw?.primaryColor ?? uiRaw?.primary_color ?? r.primaryColor, '#6366f1');

    console.log(`[sanitizeBlueprint] Manual extraction: ${tables.length} tabelle trovate`);

    return {
      appName,
      sector,
      description,
      logo,
      schema: { tables },
      ui: {
        primaryColor: primaryColor.startsWith('#') ? primaryColor : `#${primaryColor}`,
        sidebar: Array.isArray(uiRaw?.sidebar) ? uiRaw.sidebar.map((s: any) => safeString(s)) : [],
        dashboardCards: Array.isArray(uiRaw?.dashboardCards ?? uiRaw?.dashboard_cards) ? (uiRaw?.dashboardCards ?? uiRaw?.dashboard_cards) : [],
      },
    };
  } catch (e2) {
    console.error('[sanitizeBlueprint] Manual extraction also failed:', e2);
    return null;
  }
}

export function normalizeSector(sector: string): string {
  return sector
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/-+/g, '-')
    .substring(0, 50);
}

export function generateSQLTableName(appId: string, tableName: string): string {
  const safeAppId = appId.replace(/[^a-z0-9]/gi, '');
  const safeTable = tableName.replace(/[^a-z0-9_]/g, '');
  return `app_${safeAppId}_${safeTable}`;
}

export function fieldToSQLType(field: Field): string {
  switch (field.type) {
    case 'number':
    case 'currency':
      return 'NUMERIC';
    case 'boolean':
      return 'BOOLEAN';
    case 'date':
      return 'DATE';
    case 'datetime':
      return 'TIMESTAMPTZ';
    default:
      return 'TEXT';
  }
}
