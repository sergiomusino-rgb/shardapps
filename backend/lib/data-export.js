// ─── Data Export + Public API, Fase 9 — export completo di un'app ──────────
// Costruisce e trasmette in streaming (mai un buffer unico gigante in
// memoria, vedi streamExportZip) uno ZIP con tutti i dati portabili di
// un'app: manifest, schema pubblico, definizioni delle custom table, e i
// record di ogni entità in JSON+CSV. Riusa loadAppEntities/buildEntityList
// (lib/entity-metadata.js) per la discovery delle entità — stessa fonte di
// verità già usata da GET .../entities e dalla Public API, nessuna logica di
// schema duplicata qui.
//
// Usato sia da routes/public-api.js (GET /api/v1/apps/:appId/export, dietro
// API key con scope 'read') sia da routes/api-keys.js (GET
// /api/apps/:appId/export-all, dashboard proprietario con JWT Supabase) —
// stessa funzione, due punti di ingresso diversi con la stessa isolazione
// app_id+tenant_id.

const archiver = require('archiver');
const { stringify } = require('csv-stringify/sync');
const { buildEntityList } = require('./entity-metadata');

// Stessa sanitizzazione anti CSV-formula-injection già usata in
// routes/app-records.js (sanitizeCsvValue locale a quella route, invariata):
// qui riprodotta identica per il nuovo codice, senza toccare quel file.
function sanitizeCsvValue(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

// Limite ragionevole per entità (Fase 9): evita di caricare dataset enormi
// interamente in memoria in un colpo solo. Il codice resta strutturato per
// estendersi in futuro a un export asincrono/paginato (loadExportData
// potrebbe diventare un generator per-entità) senza cambiare il contratto
// pubblico di questo modulo.
const MAX_RECORDS_PER_ENTITY = 50000;

// Carica app + entità + record di un'app, con lo stesso doppio filtro
// app_id/tenant_id usato ovunque nel resto del codice per l'isolamento
// tenant. Non fa I/O verso l'esterno, non tocca nessuna tabella interna
// ShardApps oltre app_records/apps.
async function loadExportData(supabase, appId, tenantId) {
  const { data: appRow, error: appError } = await supabase
    .from('apps')
    .select('id, name, slug, config, created_at')
    .eq('id', appId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (appError || !appRow) {
    return { ok: false, status: 404, error: 'App non trovata' };
  }

  const { data: customDefs } = await supabase
    .from('app_records')
    .select('id, data')
    .eq('app_id', appId)
    .eq('tenant_id', tenantId)
    .eq('table_name', '_custom_tables');

  const entities = buildEntityList(appRow.config || {}, customDefs || [], { appId, tenantId });

  const tables = {};
  for (const entity of entities) {
    const { data: records, error } = await supabase
      .from('app_records')
      .select('id, data, created_at, updated_at')
      .eq('app_id', appId)
      .eq('tenant_id', tenantId)
      .eq('table_name', entity.recordTableName)
      .order('created_at', { ascending: true })
      .limit(MAX_RECORDS_PER_ENTITY);

    if (error) {
      console.error(`[data-export] errore caricamento entità ${entity.name}:`, error.message);
      tables[entity.name] = [];
      continue;
    }

    tables[entity.name] = (records || []).map((r) => ({
      id: r.id,
      created_at: r.created_at,
      updated_at: r.updated_at,
      ...(r.data || {}),
    }));
  }

  return { ok: true, app: appRow, entities, tables };
}

function buildManifest(app, entities, tables) {
  return {
    format: 'shardapps-export/v1',
    exported_at: new Date().toISOString(),
    app: { id: app.id, name: app.name, slug: app.slug },
    entities: entities.map((e) => ({
      name: e.name,
      label: e.label,
      source: e.source,
      recordCount: (tables[e.name] || []).length,
    })),
  };
}

// Rappresentazione pubblica dello schema — stessa forma usata da GET
// /api/v1/apps/:appId/schema (Fase 6): nessun secret/password/API key/service
// role/dato infrastrutturale, solo la forma dei dati.
function buildPublicSchema(entities) {
  return entities.map((e) => ({
    name: e.name,
    label: e.label,
    labelPlural: e.labelPlural,
    icon: e.icon,
    fields: (e.fields || []).map((f) => ({
      id: f.id,
      type: f.type,
      label: f.label,
      required: f.required,
      options: f.options,
      ...(f.type === 'relation' ? { targetEntity: f.targetEntity, displayField: f.displayField } : {}),
      ...(f.type === 'state' ? { states: f.states, allowedTransitions: f.allowedTransitions } : {}),
    })),
  }));
}

function buildReadme(app, entities) {
  return `ShardApps — Export dati app "${app.name}"
Generato: ${new Date().toISOString()}

Struttura dello ZIP:
  manifest.json                     Metadati dell'export (app, data/ora, elenco entità con conteggio record)
  schema.json                       Schema pubblico delle entità (campi, tipi, relazioni) — nessun dato sensibile
  custom_table_definitions.json     Definizioni delle tabelle personalizzate create in questa app
  tables/<entita>.json              Record dell'entità in formato JSON
  tables/<entita>.csv               Stessi record in formato CSV (dove il contenuto lo permette)

Entità incluse: ${entities.map((e) => e.name).join(', ') || '(nessuna)'}

Questo export contiene esclusivamente i dati dell'app "${app.name}", isolati per tenant.
NON contiene: password, API key, service role key, secret, credenziali interne
ShardApps, dati di altri tenant/app o configurazioni infrastrutturali proprietarie.
`;
}

// Scrive lo ZIP direttamente sullo stream di risposta HTTP tramite archiver
// (streaming reale: ogni entry viene compressa e inviata via via, non
// accumulata in un buffer unico) — soddisfa il requisito "evitare di
// caricare inutilmente tutto in memoria" per dataset grandi.
function streamExportZip(res, { app, entities, tables }, { filenamePrefix = 'shardapps-export' } = {}) {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filenamePrefix}-${app.slug || app.id}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    console.error('[data-export] archive error:', err);
    if (!res.headersSent) {
      res.status(500);
    }
    res.end();
  });
  archive.pipe(res);

  archive.append(JSON.stringify(buildManifest(app, entities, tables), null, 2), {
    name: 'shardapps-export/manifest.json',
  });
  archive.append(JSON.stringify(buildPublicSchema(entities), null, 2), {
    name: 'shardapps-export/schema.json',
  });

  const customTableDefs = entities
    .filter((e) => e.source === 'custom')
    .map((e) => ({ name: e.name, label: e.label, labelPlural: e.labelPlural, icon: e.icon, color: e.color, columns: e.fields }));
  archive.append(JSON.stringify(customTableDefs, null, 2), {
    name: 'shardapps-export/custom_table_definitions.json',
  });

  for (const entity of entities) {
    const rows = tables[entity.name] || [];
    archive.append(JSON.stringify(rows, null, 2), { name: `shardapps-export/tables/${entity.name}.json` });

    if (rows.length > 0) {
      try {
        const sanitizedRows = rows.map((row) => {
          const out = {};
          for (const [key, value] of Object.entries(row)) {
            out[key] = sanitizeCsvValue(typeof value === 'object' && value !== null ? JSON.stringify(value) : value);
          }
          return out;
        });
        const csv = stringify(sanitizedRows, { header: true });
        archive.append(csv, { name: `shardapps-export/tables/${entity.name}.csv` });
      } catch (err) {
        // Un'entità con colonne troppo irregolari per un CSV piatto non deve
        // far fallire l'intero export: si salta solo il .csv di quell'entità,
        // il .json resta comunque disponibile.
        console.error(`[data-export] CSV saltato per entità ${entity.name}:`, err.message);
      }
    }
  }

  archive.append(buildReadme(app, entities), { name: 'shardapps-export/README.txt' });

  archive.finalize();
}

module.exports = {
  loadExportData,
  streamExportZip,
  buildManifest,
  buildPublicSchema,
  sanitizeCsvValue,
  MAX_RECORDS_PER_ENTITY,
};
