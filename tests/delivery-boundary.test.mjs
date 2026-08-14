import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { tmpdir } from 'node:os';

const verifierPath = path.join(
  process.cwd(),
  'scripts',
  'verify-delivery-boundary.mjs',
);

test('customer tree contains the required application and no protected assets', async () => {
  let verifierExists = true;
  try {
    await access(verifierPath);
  } catch {
    verifierExists = false;
  }
  assert.equal(verifierExists, true, 'delivery boundary verifier is missing');
  if (!verifierExists) return;

  const { auditDeliveryTree } = await import(pathToFileURL(verifierPath).href);
  const result = await auditDeliveryTree(process.cwd());
  assert.equal(result.requiredMissing.length, 0, result.requiredMissing.join('\n'));
  assert.equal(result.forbiddenPaths.length, 0, result.forbiddenPaths.join('\n'));
  assert.equal(result.forbiddenMarkers.length, 0, result.forbiddenMarkers.join('\n'));
});

test('customer tree rejects token-shaped secrets', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'mkd-delivery-boundary-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  for (const requiredPath of [
    'apps/web-admin/client',
    'apps/web-admin/server',
    'apps/web-admin/shared',
  ]) {
    await mkdir(path.join(root, requiredPath), { recursive: true });
  }
  await writeFile(path.join(root, 'apps/web-admin/package.json'), '{}\n');
  const fakeToken = ['ghp', 'A'.repeat(36)].join('_');
  await writeFile(
    path.join(root, 'apps/web-admin/server/unsafe.ts'),
    `export const token = '${fakeToken}';\n`,
  );

  const { auditDeliveryTree } = await import(pathToFileURL(verifierPath).href);
  const result = await auditDeliveryTree(root);
  assert.equal(result.forbiddenMarkers.length, 1);
  assert.match(result.forbiddenMarkers[0], /GitHub token/);
});
