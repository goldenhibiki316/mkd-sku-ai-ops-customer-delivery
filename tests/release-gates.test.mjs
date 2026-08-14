import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const workflowUrl = new URL('../.github/workflows/ci.yml', import.meta.url);
const historyGateUrl = new URL('../scripts/verify-git-history.sh', import.meta.url);
const executeFile = promisify(execFile);

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

const secretFixtures = [
  ['GitHub token', ['ghp', 'B'.repeat(36)].join('_')],
  ['model API key', ['sk', 'C'.repeat(40)].join('-')],
  ['cloud access key', ['AKIA', 'D'.repeat(16)].join('')],
  ['private key block', ['-----BEGIN', 'PRIVATE KEY-----'].join(' ')],
  ['configured secret value', ['PGPASSWORD', 'fixture-password'].join('=')],
  [
    'database URL with password',
    ['postgresql', '//fixture-user:fixture-password@db.invalid:5432/app'].join(':'),
  ],
];

for (const [label, fixture] of secretFixtures) {
  test(`history gate rejects ${label} in an earlier commit`, async (context) => {
    const root = await mkdtemp(path.join(tmpdir(), 'mkd-history-gate-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const runGit = (...args) => executeFile('git', args, { cwd: root });
    await runGit('init', '-b', 'main');
    await runGit('config', 'user.name', 'test');
    await runGit('config', 'user.email', 'test@example.invalid');
    await writeFile(path.join(root, 'unsafe.txt'), `${fixture}\n`);
    await runGit('add', 'unsafe.txt');
    await runGit('commit', '-m', 'unsafe fixture');

    await assert.rejects(
      () => executeFile('bash', [fileURLToPath(historyGateUrl)], { cwd: root }),
      new RegExp(`secret pattern.*${label}|${label}`),
    );
  });
}
