// ─── Test di lib/public-api-openapi.js (Public API Round 2) ────────────────
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildOpenApiSpec } = require('./public-api-openapi');

test('buildOpenApiSpec: struttura minima valida (openapi/info/servers)', () => {
  const spec = buildOpenApiSpec('https://api.example.com');
  assert.equal(spec.openapi, '3.0.3');
  assert.ok(spec.info.title);
  assert.equal(spec.servers[0].url, 'https://api.example.com/api/v1/apps/{appId}');
});

test('buildOpenApiSpec: include tutti gli endpoint reali della Public API', () => {
  const spec = buildOpenApiSpec('https://api.example.com');
  const paths = Object.keys(spec.paths);
  for (const p of ['/health', '/schema', '/entities', '/entities/{entity}', '/entities/{entity}/{id}', '/export', '/webhooks/incoming']) {
    assert.ok(paths.includes(p), `manca il path ${p}`);
  }
});

test('buildOpenApiSpec: POST /entities/{entity} documenta Idempotency-Key', () => {
  const spec = buildOpenApiSpec('https://api.example.com');
  const params = spec.paths['/entities/{entity}'].post.parameters;
  assert.ok(params.some((p) => p.name === 'Idempotency-Key'));
});

test('buildOpenApiSpec: sicurezza dichiarata come bearer (API key)', () => {
  const spec = buildOpenApiSpec('https://api.example.com');
  assert.equal(spec.components.securitySchemes.ApiKeyAuth.scheme, 'bearer');
  assert.deepEqual(spec.security, [{ ApiKeyAuth: [] }]);
});
