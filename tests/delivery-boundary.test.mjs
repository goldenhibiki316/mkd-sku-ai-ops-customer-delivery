import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

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
