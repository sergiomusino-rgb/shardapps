// ─── FASE 2 — CreatorAI 2.0: Generic Database Engine (entity metadata) ─────
// Formalizza, senza introdurre un'architettura nuova, il concetto di
// "entità" già implicito in due posti diversi del codice esistente:
//
// 1. Il motore a schema fisso generato dall'AI (apps.config.schema.tables /
//    apps.config.adminPanel.entities, vedi frontend/src/lib/blueprint-schema.ts
//    e frontend/src/lib/site-schema.ts — FieldSchema con id/type/label/
//    required/options/targetEntity/displayField/states/allowedTransitions).
// 2. Le "custom table" create a runtime dall'utente/AI (backend/routes/
//    custom-tables.js — definizioni salvate come record app_records con
//    table_name='_custom_tables', colonne { name, label, type, required,
//    options }, finora SENZA alcun concetto di relazione/stato).
//
// Questo modulo non cambia il formato di storage di nessuno dei due (niente
// migration, niente DDL): normalizza entrambi in una forma canonica comune a
// runtime, riusando le stesse chiavi di FieldSchema (id/type/label/required/
// options/targetEntity/displayField/states/allowedTransitions) invece di
// duplicarne la logica. Nessuna dipendenza da zod (il backend è plain
// CommonJS, il frontend è l'unico a usare zod) — normalizzazione difensiva
// equivalente ma scritta a mano, con default sicuri come l'originale.

function toId(value, fallback = '') {
  if (value == null) return fallback;
  return String(value).toLowerCase().replace(/[^a-z0-9_]/g, '_') || fallback;
}

// Un campo canonico, qualunque sia la provenienza (field.id del motore a
// schema fisso, o column.name delle custom table): stesse chiavi di
// FieldSchema (blueprint-schema.ts) così un consumer non deve sapere da quale
// motore arriva un'entità.
function toCanonicalField(raw) {
  const id = toId(raw?.id ?? raw?.name, 'campo');
  const type = String(raw?.type || 'text').toLowerCase().trim();
  const label = raw?.label != null ? String(raw.label) : id;
  const required = raw?.required === true || raw?.required === 'true' || raw?.required === 1;
  const options = Array.isArray(raw?.options) ? raw.options : [];

  // target/targetEntity, targetLabel/displayField: stesse due coppie di nomi
  // tenute sincronizzate di FieldSchema (target storico + targetEntity
  // "ufficiale" per il motore Sito/PWA) — qualunque delle due sia arrivata,
  // l'altra viene popolata di conseguenza.
  const targetEntity = raw?.targetEntity || raw?.target || undefined;
  const displayField = raw?.displayField || raw?.targetLabel || undefined;

  const states = Array.isArray(raw?.states) && raw.states.length > 0
    ? raw.states.map((s) => String(s)).filter(Boolean)
    : undefined;
  const allowedTransitions = raw?.allowedTransitions && typeof raw.allowedTransitions === 'object'
    ? raw.allowedTransitions
    : undefined;

  return {
    id, type, label, required, options,
    target: targetEntity, targetEntity,
    targetLabel: displayField, displayField,
    states, allowedTransitions,
  };
}

// ─── Entità dal motore a schema fisso (blueprint-schema.ts::TableSchema) ───
function entitiesFromSchemaTables(tables) {
  if (!Array.isArray(tables)) return [];
  return tables.map((t) => ({
    name: toId(t?.name, 'tabella'),
    label: t?.label != null ? String(t.label) : 'Tabella',
    labelPlural: t?.labelPlural != null ? String(t.labelPlural) : undefined,
    icon: t?.icon,
    fields: Array.isArray(t?.fields) ? t.fields.map(toCanonicalField) : [],
    actions: [],
    source: 'schema',
    recordTableName: toId(t?.name, 'tabella'),
  }));
}

// ─── Entità dal motore Sito/PWA Creator v2 (site-schema.ts::AdminEntitySchema) ─
function entitiesFromAdminPanel(entities) {
  if (!Array.isArray(entities)) return [];
  return entities.map((e) => ({
    name: toId(e?.name, 'elementi'),
    label: e?.label != null ? String(e.label) : 'Elemento',
    labelPlural: e?.labelPlural != null ? String(e.labelPlural) : undefined,
    icon: e?.icon,
    fields: Array.isArray(e?.fields) ? e.fields.map(toCanonicalField) : [],
    actions: Array.isArray(e?.actions) ? e.actions : [],
    source: 'admin_panel',
    recordTableName: toId(e?.name, 'elementi'),
  }));
}

// ─── Entità dalle custom table runtime (custom-tables.js) ──────────────────
// `defs` è l'elenco già letto da app_records (table_name='_custom_tables'):
// ogni riga ha { id (record id), data: { name, label, labelPlural, icon,
// color, columns: [...] } } — stesso formato già prodotto/consumato da
// custom-tables.js, qui solo normalizzato in entità canonica.
function entitiesFromCustomTables(defs) {
  if (!Array.isArray(defs)) return [];
  return defs.map((d) => {
    const data = d?.data || d || {};
    return {
      name: toId(data.name, 'tabella'),
      label: data.label != null ? String(data.label) : 'Tabella',
      labelPlural: data.labelPlural,
      icon: data.icon,
      color: data.color,
      fields: Array.isArray(data.columns) ? data.columns.map(toCanonicalField) : [],
      actions: [],
      source: 'custom',
      recordTableName: `_custom_${toId(data.name, 'tabella')}`,
      recordId: d?.id ?? d?._record_id,
    };
  });
}

// Unifica le tre provenienze in un unico elenco di entità, indicizzato per
// nome (un'entità = un `name` univoco nell'app, coerente col vincolo di
// unicità già applicato da custom-tables.js in POST). Priorità in caso di
// collisione di nome tra motori diversi (non dovrebbe succedere in pratica,
// ma un fallback deterministico è meglio di un ordine implicito): adminPanel
// (motore più recente) > schema.tables (motore legacy) > custom (aggiunte a
// runtime, le più specifiche, vincono per ultime).
//
// `context` (appId/tenantId) è solo per "timbrare" ogni entità con l'`id`/
// `app_id`/`tenant_id` richiesti dal modello formale (Fase 2, punto 1) — la
// funzione resta pura rispetto a `config`/`customTableDefs`, nessuna query
// qui dentro (li fa il chiamante, vedi loadAppEntities in custom-tables.js).
function buildEntityList(config, customTableDefs, context) {
  const byName = new Map();
  for (const e of entitiesFromSchemaTables(config?.schema?.tables)) byName.set(e.name, e);
  for (const e of entitiesFromAdminPanel(config?.adminPanel?.entities)) byName.set(e.name, e);
  for (const e of entitiesFromCustomTables(customTableDefs)) byName.set(e.name, e);

  const appId = context?.appId;
  const tenantId = context?.tenantId;
  return [...byName.values()].map((e) => ({
    id: e.recordId ? String(e.recordId) : `${e.source}:${e.name}`,
    app_id: appId,
    tenant_id: tenantId,
    ...e,
  }));
}

function findEntity(entities, name) {
  const target = toId(name);
  return (entities || []).find((e) => e.name === target);
}

// ─── Validazione relation (targetEntity/displayField) ───────────────────────
// Stesso principio di resolveEntityRelations (site-schema.ts), ma qui a
// runtime lato server, dove oggi mancava del tutto per le custom table (il
// motore a schema fisso la applica già, ma solo in fase di generazione/
// refactor lato frontend — mai stata un problema perché quel motore non
// permette all'utente di scrivere una relation arbitraria dopo la
// generazione, a differenza delle custom table).
//
// `entitiesByName` è una Map (o un oggetto con lookup by name) delle entità
// candidate come target — il chiamante decide quali includere (es. include
// se stessa per permettere una relation "genitore" all'interno della stessa
// entità che si sta creando).
function validateRelationTarget(field, entitiesByName) {
  if (field.type !== 'relation') return { ok: true };

  const targetName = field.targetEntity;
  if (!targetName) {
    return { ok: false, reason: `Campo relazione "${field.id}" senza targetEntity` };
  }

  const target = entitiesByName instanceof Map
    ? entitiesByName.get(targetName)
    : entitiesByName?.[targetName];

  if (!target) {
    return { ok: false, reason: `targetEntity "${targetName}" non corrisponde a nessuna entità esistente` };
  }

  if (field.displayField) {
    const hasDisplayField = (target.fields || []).some((f) => f.id === field.displayField);
    if (!hasDisplayField) {
      return { ok: false, reason: `displayField "${field.displayField}" non esiste nell'entità "${targetName}"` };
    }
  }

  return { ok: true, target };
}

// Applica validateRelationTarget a tutti i campi di tipo 'relation' di
// un'entità, restituendo l'elenco di errori (vuoto = tutto valido).
function validateEntityFields(fields, entitiesByName) {
  const errors = [];
  for (const f of fields || []) {
    if (f.type !== 'relation') continue;
    const result = validateRelationTarget(f, entitiesByName);
    if (!result.ok) errors.push({ field: f.id, reason: result.reason });
  }
  return errors;
}

module.exports = {
  toId,
  toCanonicalField,
  entitiesFromSchemaTables,
  entitiesFromAdminPanel,
  entitiesFromCustomTables,
  buildEntityList,
  findEntity,
  validateRelationTarget,
  validateEntityFields,
};
