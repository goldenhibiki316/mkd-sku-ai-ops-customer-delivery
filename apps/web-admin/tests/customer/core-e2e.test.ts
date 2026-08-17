import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';

import {
  CoreClient,
  CoreUnavailableError,
} from '../../server/coreClient.ts';

test('customer CoreClient exchanges the exact public contract over a Unix Socket', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mkd-core-e2e-'));
  const socketPath = join(root, 'core.sock');
  const seen: unknown[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      seen.push({
        method: request.method,
        path: request.url,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        status: 'success',
        request_id: 'req-e2e-1',
        analysis_id: 'analysis-e2e-1',
        result: { schema_version: '3A.1' },
      }));
    });
  });

  try {
    server.listen(socketPath);
    await once(server, 'listening');
    const client = new CoreClient({ socketPath, timeoutMs: 2_000 });

    const result = await client.refreshSku({
      sku: 'SKU-1',
      requestId: 'req-e2e-1',
      actorId: 'user-1',
    });

    assert.deepEqual(seen, [{
      method: 'POST',
      path: '/v1/sku-analysis/refresh',
      body: {
        sku: 'SKU-1',
        request_id: 'req-e2e-1',
        actor_id: 'user-1',
      },
    }]);
    assert.deepEqual(result, {
      status: 'success',
      request_id: 'req-e2e-1',
      analysis_id: 'analysis-e2e-1',
      result: { schema_version: '3A.1' },
    });

    server.close();
    await once(server, 'close');
    await assert.rejects(
      () => client.refreshSku({
        sku: 'SKU-1',
        requestId: 'req-e2e-2',
        actorId: 'user-1',
      }),
      CoreUnavailableError,
    );
  } finally {
    if (server.listening) {
      server.close();
      await once(server, 'close');
    }
    await rm(root, { recursive: true, force: true });
  }
});
