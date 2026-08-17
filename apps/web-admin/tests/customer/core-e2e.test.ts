import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import express from 'express';
import session from 'express-session';

import { parseAiRefreshResponse } from '../../client/src/components/sku-detail/aiQueries.ts';
import { appErrorHandler } from '../../server/httpErrors.ts';
import { CoreClient } from '../../server/coreClient.ts';
import { requestContext } from '../../server/requestContext.ts';
import { emptyAiPayload } from '../../server/services/ai3a/analysisService.ts';
import type { AiAnalysisRow } from '../../server/services/ai3a/repository.ts';

const aiRoutesUrl = new URL('../../server/aiRoutes.ts', import.meta.url);
const fixtureExecutable = process.env.TASK13_CORE_FIXTURE_BIN?.trim();
const captureOutput = process.env.TASK13_MODEL_CAPTURE_PATH?.trim();
const e2eRequired = process.env.TASK13_REQUIRE_WEB_CORE_E2E === '1';

async function waitForFile(path: string, child: ChildProcess) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`core fixture exited before ready: ${child.exitCode}`);
    }
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error('core fixture did not become ready');
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Express test server did not expose a TCP port');
  }
  return address.port;
}

async function closeServer(server: Server) {
  if (!server.listening) return;
  server.close();
  await once(server, 'close');
}

function syntheticStoredAnalysis(): AiAnalysisRow {
  return {
    analysis_id: '00000000-0000-4000-8000-000000001399',
    sku: 'SKU-1',
    iso_year: 2026,
    iso_week: 34,
    focus_batch_id: null,
    source_analysis_id: null,
    analysis_status: 'valid',
    model_name: 'stored-history-model',
    prompt_version: null,
    schema_version: '3A.1',
    analysis_payload: emptyAiPayload(),
    error_code: null,
    error_message: null,
    token_used: null,
    cost_usd: null,
    started_at: '2026-08-18T00:00:00.000Z',
    finished_at: '2026-08-18T00:00:01.000Z',
    created_at: '2026-08-18T00:00:00.000Z',
  };
}

test(
  'authenticated Express AI routes use the real Rust core and preserve history during outage',
  {
    skip: !fixtureExecutable && !e2eRequired
      ? 'run through scripts/run-task13-web-core-e2e.sh'
      : false,
  },
  async () => {
    assert.ok(fixtureExecutable, 'TASK13_CORE_FIXTURE_BIN is required');
    assert.ok(captureOutput, 'TASK13_MODEL_CAPTURE_PATH is required');

    let routesExist = true;
    try {
      await access(aiRoutesUrl);
    } catch {
      routesExist = false;
    }
    assert.equal(routesExist, true, 'real AI route registration module is missing');
    if (!routesExist) return;

    const { registerAiRoutes } = await import(aiRoutesUrl.href);
    const externalRoot = dirname(captureOutput);
    const ownsRoot = !process.env.TASK13_E2E_ROOT;
    const root = ownsRoot
      ? await mkdtemp(join(tmpdir(), 'mkd-task13-web-core-'))
      : externalRoot;
    const socketPath = join(root, 'core.sock');
    const readyPath = join(root, 'ready.json');
    const core = spawn(fixtureExecutable, [
      'serve',
      '--socket',
      socketPath,
      '--capture',
      captureOutput,
      '--ready',
      readyPath,
    ], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const app = express();
    const httpServer = createServer(app);

    try {
      await waitForFile(readyPath, core);

      app.use(express.json());
      app.use(session({
        secret: 'task13-test-session-secret-at-least-32-characters',
        name: 'mkd.sid',
        resave: false,
        saveUninitialized: false,
        cookie: { httpOnly: true, sameSite: 'lax' },
      }));
      app.use(requestContext);
      app.post('/test/session', (req, res, next) => {
        req.session.user = {
          id: 'user-1',
          username: 'fixture-operator',
          role: 'operator',
          display_name: 'Fixture Operator',
        };
        req.session.save((error) => {
          if (error) {
            next(error);
            return;
          }
          res.json({ ok: true });
        });
      });

      const stored = syntheticStoredAnalysis();
      const repository = {
        latestUsable: async () => stored,
        latestAttempt: async () => stored,
        usableHistory: async () => [stored],
        trendHistory: async () => [{ ...stored, record_count: 1 }],
        generationHistory: async () => [stored],
        findUsableById: async (_sku: string, analysisId: string) => (
          analysisId === stored.analysis_id ? stored : null
        ),
      };
      registerAiRoutes(app, {
        repository,
        coreClient: new CoreClient({ socketPath, timeoutMs: 2_000 }),
        skuExists: async (sku: string) => sku === 'SKU-1',
      });
      app.use(appErrorHandler);

      const port = await listen(httpServer);
      const origin = `http://127.0.0.1:${port}`;
      const login = await fetch(`${origin}/test/session`, { method: 'POST' });
      assert.equal(login.status, 200);
      const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
      assert.match(cookie ?? '', /^mkd\.sid=/);
      const headers = {
        Cookie: cookie!,
        'X-Request-ID': 'req-task13-web',
      };

      const success = await fetch(`${origin}/api/skus/SKU-1/ai-refresh`, {
        method: 'POST',
        headers,
      });
      assert.equal(success.status, 200);
      const parsed = await parseAiRefreshResponse(success.clone());
      assert.equal(parsed.analysis_id, '00000000-0000-4000-8000-000000001301');
      assert.equal(parsed.analysis_status, 'valid');
      assert.equal(parsed.model_name, 'task13-fixture-model');
      assert.deepEqual(parsed.result, {
        schema_version: '3A.1',
        overall_judgement: 'fixture-ok',
      });

      const coreExit = once(core, 'exit');
      assert.equal(core.kill('SIGTERM'), true);
      await coreExit;

      const unavailable = await fetch(`${origin}/api/skus/SKU-1/ai-refresh`, {
        method: 'POST',
        headers,
      });
      assert.equal(unavailable.status, 503);
      assert.deepEqual(await unavailable.json(), {
        status: 'core_unavailable',
        message: 'AI 分析核心暂时不可用，历史分析仍可查看',
      });

      const history = await fetch(`${origin}/api/skus/SKU-1/ai/history`, {
        headers,
      });
      assert.equal(history.status, 200);
      const historyBody = await history.json() as { history?: unknown[] };
      assert.equal(historyBody.history?.length, 1);
    } finally {
      if (core.exitCode === null) {
        const coreExit = once(core, 'exit');
        core.kill('SIGTERM');
        await coreExit;
      }
      await closeServer(httpServer);
      if (ownsRoot) {
        await rm(root, { recursive: true, force: true });
      }
    }
  },
);
