import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';

const moduleUrl = new URL('../../server/coreClient.ts', import.meta.url);

function validAnalysisResult() {
  const evidence = Object.fromEntries([
    'sales',
    'profit',
    'traffic',
    'inventory',
    'aftersales',
    'competition',
    'lifecycle',
  ].map((dimension) => [dimension, {
    summary: `${dimension}-ok`,
    evidence: [{
      metric: `${dimension}_fixture`,
      value: '1',
      threshold: '0',
      verdict: 'fixture-ok',
    }],
  }]));

  return {
    schema_version: '3A.1',
    sop_v3_type: 'fixture-decision',
    trigger_reasons: ['fixture-evidence'],
    overall_judgement: 'fixture-ok',
    risk_level: 'low',
    risk_tags: [],
    diagnosis: evidence,
    actions: [{
      task_type: 'monitor',
      title: 'Monitor fixture SKU',
      specific_change: 'Keep the verified fixture state',
      reason: 'Task 13 contract verification',
      owner: 'operator',
      priority: 1,
      guardrail: 'Preserve the approved SKU boundary',
      based_on_real_data: true,
      depends_on_fake_data: [],
    }],
    missing_inputs: [],
  };
}

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
          analysis_status: 'valid',
          model_name: 'fixture-model',
          result: validAnalysisResult(),
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
    analysis_status: 'valid',
    model_name: 'fixture-model',
    result: validAnalysisResult(),
  });
});

test('refreshSku rejects every incomplete or malformed HTTP 200 success body', async (context) => {
  const {
    CoreClient,
    CoreProtocolError,
  } = await import(moduleUrl.href);
  const validBody: Record<string, unknown> = {
    status: 'success',
    request_id: 'req-1',
    analysis_id: 'analysis-1',
    analysis_status: 'valid',
    model_name: 'fixture-model',
    result: validAnalysisResult(),
  };
  const nestedPrivatePrompt = validAnalysisResult();
  Object.assign(nestedPrivatePrompt.diagnosis.sales.evidence[0], {
    private_prompt: 'must-not-pass',
  });
  const unknownActionField = validAnalysisResult();
  Object.assign(unknownActionField.actions[0], { sql: 'must-not-pass' });
  const unknownDiagnosisField = validAnalysisResult();
  Object.assign(unknownDiagnosisField.diagnosis.sales, {
    prompt: 'must-not-pass',
  });
  const emptyDimensionEvidence = validAnalysisResult();
  emptyDimensionEvidence.diagnosis.sales.evidence = [];
  const missingDimension = validAnalysisResult();
  delete missingDimension.diagnosis.lifecycle;
  const cases: Array<[string, Record<string, unknown>]> = [
    ['missing analysis_id', { ...validBody, analysis_id: undefined }],
    ['empty analysis_id', { ...validBody, analysis_id: '   ' }],
    ['invalid analysis_status', { ...validBody, analysis_status: 'generating' }],
    ['missing model_name', { ...validBody, model_name: undefined }],
    ['empty model_name', { ...validBody, model_name: '   ' }],
    ['wrong request_id', { ...validBody, request_id: 'req-other' }],
    ['null result', { ...validBody, result: null }],
    ['string result', { ...validBody, result: 'fixture-ok' }],
    ['array result', { ...validBody, result: [validAnalysisResult()] }],
    ['schema-invalid result', { ...validBody, result: { schema_version: '3A.1' } }],
    [
      'wrong result schema version',
      {
        ...validBody,
        result: { ...validAnalysisResult(), schema_version: '3A.0' },
      },
    ],
    [
      'valid status with incomplete result',
      {
        ...validBody,
        result: { ...validAnalysisResult(), missing_inputs: ['fixture-source'] },
      },
    ],
    [
      'nested private_prompt in evidence',
      { ...validBody, result: nestedPrivatePrompt },
    ],
    [
      'action containing no approved fields',
      { ...validBody, result: { ...validAnalysisResult(), actions: [{}] } },
    ],
    [
      'unknown action field',
      { ...validBody, result: unknownActionField },
    ],
    [
      'unknown diagnosis field',
      { ...validBody, result: unknownDiagnosisField },
    ],
    [
      'empty seven-dimensional evidence',
      {
        ...validBody,
        analysis_status: 'incomplete',
        result: emptyDimensionEvidence,
      },
    ],
    [
      'wrong seven-dimensional evidence type',
      {
        ...validBody,
        analysis_status: 'incomplete',
        result: {
          ...validAnalysisResult(),
          diagnosis: { ...validAnalysisResult().diagnosis, sales: [] },
        },
      },
    ],
    [
      'missing seven-dimensional evidence field',
      { ...validBody, analysis_status: 'incomplete', result: missingDimension },
    ],
    [
      'unknown result field',
      {
        ...validBody,
        result: { ...validAnalysisResult(), private_prompt: 'must-not-pass' },
      },
    ],
    ['unknown top-level field', { ...validBody, private_prompt: 'must-not-pass' }],
    [
      'missing result',
      Object.fromEntries(
        Object.entries(validBody).filter(([field]) => field !== 'result'),
      ),
    ],
  ];

  for (const [name, body] of cases) {
    await context.test(name, async () => {
      const client = new CoreClient({
        socketPath: '/tmp/test.sock',
        transport: async () => ({ status: 200, body }),
      });

      await assert.rejects(
        () => client.refreshSku({
          sku: 'SKU-1',
          requestId: 'req-1',
          actorId: 'user-1',
        }),
        CoreProtocolError,
      );
    });
  }
});

test('refreshSku returns the strict schema output instead of the original result', async () => {
  const { CoreClient } = await import(moduleUrl.href);
  const result = validAnalysisResult();
  result.sop_v3_type = ' fixture-decision ';
  result.actions[0].title = ' Monitor fixture SKU ';
  const client = new CoreClient({
    socketPath: '/tmp/test.sock',
    transport: async () => ({
      status: 200,
      body: {
        status: 'success',
        request_id: 'req-1',
        analysis_id: 'analysis-1',
        analysis_status: 'valid',
        model_name: 'fixture-model',
        result,
      },
    }),
  });

  const response = await client.refreshSku({
    sku: 'SKU-1',
    requestId: 'req-1',
    actorId: 'user-1',
  });

  assert.notStrictEqual(response.result, result);
  assert.deepEqual(response.result, validAnalysisResult());
  assert.equal(result.sop_v3_type, ' fixture-decision ');
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

test('refreshSku preserves the approved core HTTP status contract', async () => {
  const {
    CoreClient,
    CoreResponseError,
  } = await import(moduleUrl.href);
  const cases = [
    [400, 'invalid_request'],
    [404, 'not_found'],
    [409, 'generating'],
    [422, 'schema_invalid'],
    [500, 'internal_error'],
    [502, 'model_failed'],
  ] as const;

  for (const [statusCode, coreStatus] of cases) {
    const body = {
      status: coreStatus,
      request_id: `req-${statusCode}`,
      analysis_id: null,
      result: null,
    };
    const client = new CoreClient({
      socketPath: '/tmp/test.sock',
      transport: async () => ({ status: statusCode, body }),
    });

    await assert.rejects(
      () => client.refreshSku({
        sku: 'SKU-1',
        requestId: `req-${statusCode}`,
        actorId: 'user-1',
      }),
      (error: unknown) => {
        assert.equal(error instanceof CoreResponseError, true);
        assert.equal((error as InstanceType<typeof CoreResponseError>).statusCode, statusCode);
        assert.deepEqual((error as InstanceType<typeof CoreResponseError>).response, body);
        return true;
      },
    );
  }
});
