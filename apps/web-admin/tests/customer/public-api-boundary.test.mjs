import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const routesUrl = new URL('../../server/routes.ts', import.meta.url);
const repositoryUrl = new URL(
  '../../server/services/ai3a/repository.ts',
  import.meta.url,
);

test('public routes preserve approved APIs and delegate refresh to the local core', async () => {
  let routesExist = true;
  try {
    await access(routesUrl);
  } catch {
    routesExist = false;
  }
  assert.equal(routesExist, true, 'public routes are missing');
  if (!routesExist) return;

  const routes = await readFile(routesUrl, 'utf8');
  for (const endpoint of [
    '/api/health',
    '/api/overview',
    '/api/tasks',
    '/api/types',
    '/api/skus/:sku/ai-analysis',
    '/api/skus/:sku/ai/history',
    '/api/skus/:sku/summary',
    '/api/skus/:sku/buybox',
    '/api/skus/:sku/our-price',
    '/api/skus/:sku/ai-refresh',
    '/api/transitions',
  ]) {
    assert.equal(routes.includes(endpoint), true, `missing endpoint ${endpoint}`);
  }
  assert.match(routes, /coreClient\.refreshSku/);

  const forbidden = [
    ['SOP', 'V3', 'MATRIX'].join('_'),
    ['LEARNED', 'FROM', 'HISTORY', 'SOP'].join('_'),
    ['OPENAI', 'API', 'KEY'].join('_'),
    ['MINELONA', 'API', 'KEY'].join('_'),
    ['chat', 'completions'].join('/'),
    ['seven', 'fields', 'weekly'].join('_'),
    ['ruleTask', 'Generator'].join(''),
  ];
  for (const marker of forbidden) {
    assert.equal(routes.includes(marker), false, `protected marker ${marker}`);
  }
});

test('AI history repository is query-only', async () => {
  const repository = await readFile(repositoryUrl, 'utf8');
  assert.doesNotMatch(repository, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(repository, /\bUPDATE\s+[a-z_]/i);
  assert.doesNotMatch(repository, /\bDELETE\s+FROM\b/i);
});

test('AI refresh preserves approved core statuses and reserves 503 for transport failures', async () => {
  const routes = await readFile(routesUrl, 'utf8');

  assert.match(routes, /CoreResponseError/);
  assert.match(routes, /error instanceof CoreResponseError/);
  assert.match(routes, /res\.status\(error\.statusCode\)\.json\(error\.response\)/);
  assert.match(
    routes,
    /error instanceof CoreUnavailableError\s*\|\|\s*error instanceof CoreProtocolError/,
  );
  assert.match(routes, /res\.status\(503\)/);
});
