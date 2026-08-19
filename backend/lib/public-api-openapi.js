'use strict';

// ─── OpenAPI 3.0 minimale per la Public API v1 (Public API Round 2) ────────
// Documentazione machine-readable della stessa API già descritta in prosa da
// frontend/app/a/[slug]/settings/api-docs/page.tsx — non un secondo contratto,
// solo una rappresentazione OpenAPI degli endpoint reali di
// backend/routes/public-api.js, per chi vuole generare un client o importarla
// in Postman/Insomnia. Deliberatamente minimale (no schemi di risposta
// esaustivi per ogni entità dinamica, che non sono conoscibili staticamente
// visto che ogni app ha uno schema diverso) — non una riscrittura della
// Public API, solo un artefatto di documentazione in più.

function buildOpenApiSpec(baseUrl) {
  const server = `${baseUrl}/api/v1/apps/{appId}`;
  const apiKeyScheme = {
    type: 'http',
    scheme: 'bearer',
    description: 'API key generata in Dashboard → Impostazioni → Data & API. Vincolata a una sola app.',
  };

  return {
    openapi: '3.0.3',
    info: {
      title: 'ShardApps Public API v1',
      version: '1.0.0',
      description: 'API REST per leggere/scrivere i dati di una singola app ShardApps e ricevere eventi in ingresso da servizi esterni. Ogni richiesta è isolata per app/tenant tramite l\'API key usata.',
    },
    servers: [{ url: server, description: 'Base URL — {appId} è l\'id dell\'app' }],
    security: [{ ApiKeyAuth: [] }],
    components: {
      securitySchemes: { ApiKeyAuth: apiKeyScheme },
      parameters: {
        appId: { name: 'appId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        entity: { name: 'entity', in: 'path', required: true, schema: { type: 'string' } },
        id: { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      },
      responses: {
        Unauthorized: { description: 'API key mancante, malformata, non valida, revocata o scaduta' },
        Forbidden: { description: 'API key valida ma non autorizzata (app diversa, scope mancante, abbonamento non attivo)' },
        NotFound: { description: 'App, entità o record non trovato' },
        TooManyRequests: { description: 'Rate limit superato (100 richieste/minuto per chiave)' },
      },
    },
    paths: {
      '/health': {
        get: {
          summary: 'Verifica rapida della chiave',
          parameters: [{ $ref: '#/components/parameters/appId' }],
          responses: { 200: { description: 'Chiave valida' }, 401: { $ref: '#/components/responses/Unauthorized' } },
        },
      },
      '/schema': {
        get: {
          summary: 'Struttura dati pubblica dell\'app (scope: read)',
          parameters: [{ $ref: '#/components/parameters/appId' }],
          responses: { 200: { description: 'Elenco entità con campi/tipi' }, 403: { $ref: '#/components/responses/Forbidden' } },
        },
      },
      '/entities': {
        get: {
          summary: 'Elenco entità disponibili (scope: read)',
          parameters: [{ $ref: '#/components/parameters/appId' }],
          responses: { 200: { description: 'Elenco leggero delle entità' }, 403: { $ref: '#/components/responses/Forbidden' } },
        },
      },
      '/entities/{entity}': {
        get: {
          summary: 'Elenco record di un\'entità (scope: read)',
          parameters: [
            { $ref: '#/components/parameters/appId' }, { $ref: '#/components/parameters/entity' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
            { name: 'sort', in: 'query', schema: { type: 'string', enum: ['created_at', 'updated_at'] } },
            { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
          ],
          responses: { 200: { description: 'records[], count, limit, offset' }, 404: { $ref: '#/components/responses/NotFound' } },
        },
        post: {
          summary: 'Crea un record (scope: write)',
          parameters: [
            { $ref: '#/components/parameters/appId' }, { $ref: '#/components/parameters/entity' },
            {
              name: 'Idempotency-Key', in: 'header', required: false,
              description: 'Chiave opzionale (max 200 caratteri): un retry con la stessa chiave restituisce la risposta già data invece di creare un secondo record.',
              schema: { type: 'string', maxLength: 200 },
            },
          ],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', description: 'Campi del record, secondo lo schema dell\'entità' } } } },
          responses: { 201: { description: 'Record creato' }, 400: { description: 'Campi non validi' }, 403: { $ref: '#/components/responses/Forbidden' } },
        },
      },
      '/entities/{entity}/{id}': {
        get: {
          summary: 'Singolo record (scope: read)',
          parameters: [{ $ref: '#/components/parameters/appId' }, { $ref: '#/components/parameters/entity' }, { $ref: '#/components/parameters/id' }],
          responses: { 200: { description: 'Record' }, 404: { $ref: '#/components/responses/NotFound' } },
        },
        patch: {
          summary: 'Aggiorna parzialmente un record (scope: write)',
          parameters: [{ $ref: '#/components/parameters/appId' }, { $ref: '#/components/parameters/entity' }, { $ref: '#/components/parameters/id' }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', description: 'Solo i campi da modificare' } } } },
          responses: { 200: { description: 'Record aggiornato' }, 404: { $ref: '#/components/responses/NotFound' } },
        },
        delete: {
          summary: 'Elimina un record (scope: write)',
          parameters: [{ $ref: '#/components/parameters/appId' }, { $ref: '#/components/parameters/entity' }, { $ref: '#/components/parameters/id' }],
          responses: { 200: { description: 'Eliminato' }, 404: { $ref: '#/components/responses/NotFound' } },
        },
      },
      '/export': {
        get: {
          summary: 'Export completo in ZIP (scope: read)',
          parameters: [{ $ref: '#/components/parameters/appId' }],
          responses: { 200: { description: 'File ZIP (manifest, schema, dati)', content: { 'application/zip': {} } } },
        },
      },
      '/webhooks/incoming': {
        post: {
          summary: 'Ricevi un evento da un servizio esterno (scope: webhook)',
          description: 'Innesca i workflow con trigger "Webhook ricevuto" configurati in Dashboard → Automazione.',
          parameters: [
            { $ref: '#/components/parameters/appId' },
            { name: 'entity', in: 'query', required: false, schema: { type: 'string' }, description: 'Filtra i workflow che reagiscono solo a questa entità' },
          ],
          requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', maxProperties: 1000, description: 'Payload libero, max 100KB' } } } },
          responses: { 200: { description: '{ received: true, matched, executed }' }, 413: { description: 'Payload oltre 100KB' } },
        },
      },
    },
  };
}

module.exports = { buildOpenApiSpec };
