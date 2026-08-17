import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const rootPackageUrl = new URL('../../../../package.json', import.meta.url);
const appPackageUrl = new URL('../../package.json', import.meta.url);
const routesUrl = new URL('../../server/routes.ts', import.meta.url);
const coreClientUrl = new URL('../../server/coreClient.ts', import.meta.url);
const workbenchUrl = new URL('../../client/src/pages/Workbench.tsx', import.meta.url);
const taskFiltersUrl = new URL('../../server/services/taskFilters.ts', import.meta.url);
const taskReadServiceUrl = new URL('../../server/services/taskReadService.ts', import.meta.url);
const taskAssignmentPolicyUrl = new URL(
  '../../server/services/taskAssignmentPolicy.ts',
  import.meta.url,
);
const envExampleUrl = new URL('../../.env.example', import.meta.url);

async function mustRead(url) {
  await access(url);
  return readFile(url, 'utf8');
}

test('customer delivery is rebased onto web admin v2.1.8 public task surface', async () => {
  const rootPackage = JSON.parse(await mustRead(rootPackageUrl));
  const appPackage = JSON.parse(await mustRead(appPackageUrl));
  assert.equal(rootPackage.version, '2.1.8-customer.1');
  assert.equal(appPackage.version, '2.1.8-customer.1');

  const assignmentPolicy = await mustRead(taskAssignmentPolicyUrl);
  assert.match(assignmentPolicy, /TaskReopenRequiredError/);
  assert.match(assignmentPolicy, /planAssignmentChange/);
  assert.match(assignmentPolicy, /canOperateTask/);

  const taskFilters = await mustRead(taskFiltersUrl);
  assert.match(taskFilters, /ownerFilter/);
  assert.match(taskFilters, /input\.user\?\.role === "operator"/);
  assert.match(taskFilters, /owner IS NULL/);

  const taskReadService = await mustRead(taskReadServiceUrl);
  assert.match(taskReadService, /owner_user\.display_name AS owner_display_name/);
  assert.match(taskReadService, /loadTaskPageWithOptionalReadSnapshot/);

  const workbench = await mustRead(workbenchUrl);
  for (const marker of [
    'task_pool',
    'task_assigned',
    'btn-batch-assign-selection',
    'owner-filter-${o.k}',
    'assign-release',
  ]) {
    assert.equal(workbench.includes(marker), true, `missing Workbench marker ${marker}`);
  }
});

test('v2.1.8 customer delivery still exposes only the public core contract', async () => {
  const routes = await mustRead(routesUrl);
  const coreClient = await mustRead(coreClientUrl);

  assert.match(routes, /coreClient\.refreshSku/);
  assert.match(coreClient, /sku:\s*requiredIdentifier\(input\.sku/);
  assert.match(coreClient, /request_id:\s*requiredIdentifier\(input\.requestId/);
  assert.match(coreClient, /actor_id:\s*requiredIdentifier\(input\.actorId/);

  for (const forbidden of [
    ['SOP', 'V3', 'MATRIX'].join('_'),
    ['OFFICIAL', 'RULES', 'DIGEST'].join('_'),
    ['LEARNED', 'FROM', 'HISTORY', 'SOP'].join('_'),
    ['ADS', 'PROMOTION', 'SOP'].join('_'),
    ['chat', 'completions'].join('/'),
    ['server', 'jobs', 'sevenFieldsWeekly'].join('/'),
    ['sql', 'seven-fields'].join('/'),
    ['sourceMapping', 'URL'].join(''),
  ]) {
    assert.equal(routes.includes(forbidden), false, `routes leaked ${forbidden}`);
    assert.equal(coreClient.includes(forbidden), false, `coreClient leaked ${forbidden}`);
  }
});

test('public deployment template exposes the approved anchor and core knobs only', async () => {
  const envExample = await mustRead(envExampleUrl);

  for (const marker of [
    'DATA_ANCHOR_DATE=',
    'VITE_DATA_ANCHOR_DATE=',
    'MKD_CORE_SOCKET=',
    'MKD_CORE_TIMEOUT_MS=',
  ]) {
    assert.equal(envExample.includes(marker), true, `missing public env marker ${marker}`);
  }

  for (const forbidden of [
    'sk-',
    'AKIA',
    'BEGIN PRIVATE KEY',
    'postgresql://',
    `${['MODEL', 'API', 'KEY'].join('_')}=`,
  ]) {
    assert.equal(envExample.includes(forbidden), false, `env template leaked ${forbidden}`);
  }
});
