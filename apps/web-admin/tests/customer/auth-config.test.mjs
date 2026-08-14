import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const authUrl = new URL('../../server/auth.ts', import.meta.url);

test('customer authentication requires a strong external session secret', async () => {
  const auth = await readFile(authUrl, 'utf8');
  assert.match(auth, /SESSION_SECRET\?\.trim\(\)/);
  assert.match(auth, /secret\.length < 32/);
  assert.doesNotMatch(auth, /dev-secret-change-in-prod/);
});

test('secure cookie behavior is runtime-configurable', async () => {
  const auth = await readFile(authUrl, 'utf8');
  assert.match(auth, /COOKIE_SECURE/);
  assert.doesNotMatch(auth, /secure:\s*false/);
});
