import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const routesUrl = new URL('../../server/routes.ts', import.meta.url);
const aiRoutesUrl = new URL('../../server/aiRoutes.ts', import.meta.url);
const repositoryUrl = new URL(
  '../../server/services/ai3a/repository.ts',
  import.meta.url,
);
const coreE2eUrl = new URL('./core-e2e.test.ts', import.meta.url);

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
  const aiRoutes = await readFile(aiRoutesUrl, 'utf8');
  const apiSurface = `${routes}\n${aiRoutes}`;
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
    assert.equal(apiSurface.includes(endpoint), true, `missing endpoint ${endpoint}`);
  }
  assert.match(aiRoutes, /coreClient\.refreshSku/);

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
    assert.equal(apiSurface.includes(marker), false, `protected marker ${marker}`);
  }
});

test('AI history repository is query-only', async () => {
  const repository = await readFile(repositoryUrl, 'utf8');
  assert.doesNotMatch(repository, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(repository, /\bUPDATE\s+[a-z_]/i);
  assert.doesNotMatch(repository, /\bDELETE\s+FROM\b/i);
});

test('AI refresh preserves approved core statuses and reserves 503 for transport failures', async () => {
  const routes = await readFile(aiRoutesUrl, 'utf8');

  assert.match(routes, /CoreResponseError/);
  assert.match(routes, /error instanceof CoreResponseError/);
  assert.match(routes, /res\.status\(error\.statusCode\)\.json\(error\.response\)/);
  assert.match(
    routes,
    /error instanceof CoreUnavailableError\s*\|\|\s*error instanceof CoreProtocolError/,
  );
  assert.match(routes, /res\.status\(503\)/);
});

test('cross-repository E2E authenticates through a pre-seeded real session only', async () => {
  const e2e = await readFile(coreE2eUrl, 'utf8');

  assert.doesNotMatch(e2e, /\/test\/session/);
  assert.match(e2e, /new session\.MemoryStore\(\)/);
  assert.match(e2e, /unauthenticated\.status, 401/);
  assert.match(e2e, /createHmac\(['"]sha256['"]/);
});
