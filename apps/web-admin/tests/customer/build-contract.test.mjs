import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const buildUrl = new URL('../../script/build.ts', import.meta.url);
const versionUrl = new URL('../../server/version.ts', import.meta.url);
const routesUrl = new URL('../../server/routes.ts', import.meta.url);

async function exists(url) {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
}

test('customer build emits only Web artifacts without source maps', async () => {
  assert.equal(await exists(buildUrl), true, 'Web build script is missing');
  if (!await exists(buildUrl)) return;
  const build = await readFile(buildUrl, 'utf8');
  assert.match(build, /entryPoints:\s*\["server\/index\.ts"\]/);
  assert.match(build, /sourcemap:\s*false/);
  assert.doesNotMatch(build, /server\/jobs/);
  assert.doesNotMatch(build, /seven-fields-weekly|read-model-refresh|hourly-rule-task/);
});

test('customer API exposes immutable build identity', async () => {
  assert.equal(await exists(versionUrl), true, 'version module is missing');
  if (!await exists(versionUrl)) return;
  const routes = await readFile(routesUrl, 'utf8');
  const version = await readFile(versionUrl, 'utf8');
  assert.match(routes, /\/api\/version/);
  assert.match(version, /commit_sha/);
  assert.match(version, /built_at/);
});
