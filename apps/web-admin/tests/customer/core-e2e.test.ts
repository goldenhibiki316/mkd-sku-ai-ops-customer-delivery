import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
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
import { normalizeAiPayload } from '../../server/services/ai3a/payloadNormalizer.ts';
import type { AiAnalysisRow } from '../../server/services/ai3a/repository.ts';
import { aiPayloadSchema } from '../../shared/ai3a.ts';

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

function signedSessionCookie(name: string, sessionId: string, secret: string): string {
  const digest = createHmac('sha256', secret)
    .update(sessionId)
    .digest('base64')
    .replace(/=+$/, '');
  return `${name}=${encodeURIComponent(`s:${sessionId}.${digest}`)}`;
}

function spawnCore(
  executable: string,
  socketPath: string,
  capturePath: string,
  readyPath: string,
): ChildProcess {
  return spawn(executable, [
    'serve',
    '--socket',
    socketPath,
    '--capture',
    capturePath,
    '--ready',
    readyPath,
  ], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

function assertAcceptedAiPayload(parsed: {
  analysis_status: 'valid' | 'incomplete';
  model_name: string;
  result: unknown;
}) {
  const normalized = normalizeAiPayload(parsed.result, {
    source: 'generated',
    modelName: parsed.model_name,
    promptVersion: null,
  });
  assert.equal(normalized.status, parsed.analysis_status);
  assert.equal(aiPayloadSchema.safeParse(normalized.payload).success, true);
  return normalized.payload;
}

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  assert.equal(Boolean(value) && typeof value === 'object' && !Array.isArray(value), true);
}

function assertResultMatchesCapturedDecision(resultValue: unknown, decisionValue: unknown) {
  assertRecord(resultValue);
  assertRecord(decisionValue);
  assertRecord(decisionValue.risk);
  assert.equal(resultValue.sop_v3_type, decisionValue.classification_zh);
  assert.deepEqual(resultValue.trigger_reasons, decisionValue.trigger_reasons);
  assert.equal(resultValue.risk_level, decisionValue.risk.level);
  assert.deepEqual(resultValue.risk_tags, decisionValue.risk.tags);
  assert.deepEqual(resultValue.diagnosis, decisionValue.evidence);
  assert.deepEqual(resultValue.actions, decisionValue.actions);
  assert.deepEqual(resultValue.missing_inputs, decisionValue.missing_inputs);
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
  'protected Express AI routes use the real Rust core, preserve history, and recover after restart',
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
    let core = spawnCore(fixtureExecutable, socketPath, captureOutput, readyPath);
    const app = express();
    const httpServer = createServer(app);

    try {
      await waitForFile(readyPath, core);

      app.use(express.json());
      const sessionSecret = 'task13-test-session-secret-at-least-32-characters';
      const sessionName = 'mkd.sid';
      const sessionId = 'task13-preseeded-session-id';
      const sessionStore = new session.MemoryStore();
      await new Promise<void>((resolve, reject) => {
        sessionStore.set(sessionId, {
          cookie: new session.Cookie({
            httpOnly: true,
            path: '/',
            sameSite: 'lax',
          }),
          user: {
            id: 'user-1',
            username: 'fixture-operator',
            role: 'operator',
            display_name: 'Fixture Operator',
          },
        }, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      app.use(session({
        secret: sessionSecret,
        name: sessionName,
        resave: false,
        saveUninitialized: false,
        store: sessionStore,
        cookie: { httpOnly: true, sameSite: 'lax' },
      }));
      app.use(requestContext);

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
      const unauthenticated = await fetch(`${origin}/api/skus/SKU-1/ai-refresh`, {
        method: 'POST',
        headers: { 'X-Request-ID': 'req-task13-unauthenticated' },
      });
      assert.equal(unauthenticated.status, 401);
      assert.deepEqual(await unauthenticated.json(), { error: '未登录' });

      const headers = {
        Cookie: signedSessionCookie(sessionName, sessionId, sessionSecret),
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
      const normalized = assertAcceptedAiPayload(parsed);
      assert.equal(normalized.schema_version, '3A.1');
      assert.equal(normalized.conclusion.text, 'fixture-ok');
      const capture = JSON.parse(await readFile(captureOutput, 'utf8')) as unknown;
      assertRecord(capture);
      assertResultMatchesCapturedDecision(parsed.result, capture.decision);

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

      const restartReadyPath = join(root, 'ready-restart.json');
      const restartCapturePath = join(root, 'model-capture-restart.json');
      core = spawnCore(
        fixtureExecutable,
        socketPath,
        restartCapturePath,
        restartReadyPath,
      );
      await waitForFile(restartReadyPath, core);

      const recovered = await fetch(`${origin}/api/skus/SKU-1/ai-refresh`, {
        method: 'POST',
        headers,
      });
      assert.equal(recovered.status, 200);
      const recoveredParsed = await parseAiRefreshResponse(recovered.clone());
      assert.equal(recoveredParsed.analysis_status, 'valid');
      assert.equal(assertAcceptedAiPayload(recoveredParsed).conclusion.text, 'fixture-ok');
      const restartCapture = JSON.parse(
        await readFile(restartCapturePath, 'utf8'),
      ) as unknown;
      assertRecord(restartCapture);
      assertResultMatchesCapturedDecision(
        recoveredParsed.result,
        restartCapture.decision,
      );
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
