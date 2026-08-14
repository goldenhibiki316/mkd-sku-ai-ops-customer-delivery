import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../.github/workflows/ci.yml', import.meta.url);
const historyGateUrl = new URL('../scripts/verify-git-history.sh', import.meta.url);

async function exists(url) {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
}

test('CI runs build, tests, audit, and both leakage gates', async () => {
  assert.equal(await exists(workflowUrl), true, 'CI workflow is missing');
  if (!await exists(workflowUrl)) return;
  const workflow = await readFile(workflowUrl, 'utf8');
  for (const command of [
    'npm ci',
    'npm audit',
    'npm run check',
    'npm run test:customer',
    'npm run build',
    'verify-delivery-boundary.mjs',
    'verify-git-history.sh',
  ]) {
    assert.equal(workflow.includes(command), true, `CI command missing: ${command}`);
  }
});

test('history gate scans every reachable commit', async () => {
  assert.equal(await exists(historyGateUrl), true, 'history gate is missing');
  if (!await exists(historyGateUrl)) return;
  const gate = await readFile(historyGateUrl, 'utf8');
  assert.match(gate, /git rev-list --all/);
  assert.match(gate, /git ls-tree/);
  assert.match(gate, /git grep/);
});
