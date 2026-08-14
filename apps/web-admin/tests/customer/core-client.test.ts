import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';

const moduleUrl = new URL('../../server/coreClient.ts', import.meta.url);

test('refreshSku sends only protocol metadata and one SKU', async () => {
  let moduleExists = true;
  try {
    await access(moduleUrl);
  } catch {
    moduleExists = false;
  }
  assert.equal(moduleExists, true, 'CoreClient module is missing');
  if (!moduleExists) return;

  const { CoreClient } = await import(moduleUrl.href);
  const seen: unknown[] = [];
  const client = new CoreClient({
    socketPath: '/tmp/test.sock',
    transport: async (request) => {
      seen.push(request);
      return {
        status: 200,
        body: {
          status: 'success',
          request_id: 'req-1',
          analysis_id: 'analysis-1',
          result: { schema_version: '3A.1' },
        },
      };
    },
  });

  const response = await client.refreshSku({
    sku: 'SKU-1',
    requestId: 'req-1',
    actorId: 'user-1',
  });

  assert.deepEqual(seen, [{
    method: 'POST',
    path: '/v1/sku-analysis/refresh',
    body: {
      sku: 'SKU-1',
      request_id: 'req-1',
      actor_id: 'user-1',
    },
  }]);
  assert.deepEqual(response, {
    status: 'success',
    request_id: 'req-1',
    analysis_id: 'analysis-1',
    result: { schema_version: '3A.1' },
  });
});

test('refreshSku rejects identifiers outside the public contract', async () => {
  let moduleExists = true;
  try {
    await access(moduleUrl);
  } catch {
    moduleExists = false;
  }
  assert.equal(moduleExists, true, 'CoreClient module is missing');
  if (!moduleExists) return;

  const { CoreClient } = await import(moduleUrl.href);
  const client = new CoreClient({
    socketPath: '/tmp/test.sock',
    transport: async () => {
      throw new Error('transport must not run');
    },
  });

  await assert.rejects(
    () => client.refreshSku({
      sku: '',
      requestId: 'req-1',
      actorId: 'user-1',
    }),
    /sku is required/,
  );
});
