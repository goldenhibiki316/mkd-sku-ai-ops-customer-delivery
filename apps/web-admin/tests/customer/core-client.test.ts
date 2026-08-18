import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';

import type { CoreTransportRequest } from '../../server/coreClient';
import type { GeneratedAnalysisResult } from '../../server/services/ai3a/generatedResultSchema';

const moduleUrl = new URL('../../server/coreClient.ts', import.meta.url);

function validDimension(
  dimension: keyof GeneratedAnalysisResult['diagnosis'],
): GeneratedAnalysisResult['diagnosis']['sales'] {
  return {
    summary: `${dimension}-ok`,
    evidence: [{
      metric: `${dimension}_fixture`,
      value: '1',
      threshold: '0',
      verdict: 'fixture-ok',
    }],
  };
}

function validAnalysisResult(): GeneratedAnalysisResult {
  return {
    schema_version: '3A.1',
    sop_v3_type: 'fixture-decision',
    trigger_reasons: ['fixture-evidence'],
    overall_judgement: 'fixture-ok',
    risk_level: 'low',
    risk_tags: [],
    diagnosis: {
      sales: validDimension('sales'),
      profit: validDimension('profit'),
      traffic: validDimension('traffic'),
      inventory: validDimension('inventory'),
      aftersales: validDimension('aftersales'),
      competition: validDimension('competition'),
      lifecycle: validDimension('lifecycle'),
    },
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
  const seen: CoreTransportRequest[] = [];
  const client = new CoreClient({
    socketPath: '/tmp/test.sock',
    transport: async (request: CoreTransportRequest) => {
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

test('refreshSku accepts strict incomplete results when the declared status matches', async (context) => {
  const { CoreClient } = await import(moduleUrl.href);
  const cases: Array<[string, (result: ReturnType<typeof validAnalysisResult>) => void]> = [
    ['empty actions', (result) => { result.actions = []; }],
    ['empty traffic evidence', (result) => { result.diagnosis.traffic.evidence = []; }],
    ['unknown risk', (result) => { result.risk_level = 'unknown'; }],
    ['pending risk', (result) => { result.risk_level = 'pending'; }],
    ['high risk without tags', (result) => { result.risk_level = 'high'; }],
    ['medium risk without tags', (result) => { result.risk_level = 'medium'; }],
    ['reported missing inputs', (result) => {
      result.missing_inputs = ['weekly_gmv_clp'];
    }],
  ];

  for (const [name, mutate] of cases) {
    await context.test(name, async () => {
      const result = validAnalysisResult();
      mutate(result);
      const client = new CoreClient({
        socketPath: '/tmp/test.sock',
        transport: async () => ({
          status: 200,
          body: {
            status: 'success',
            request_id: 'req-1',
            analysis_id: 'analysis-1',
            analysis_status: 'incomplete',
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

      assert.equal(response.analysis_status, 'incomplete');
      assert.notStrictEqual(response.result, result);
      assert.deepEqual(response.result, result);
    });
  }
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
  const {
    lifecycle: _missingLifecycle,
    ...diagnosisWithoutLifecycle
  } = validAnalysisResult().diagnosis;
  const missingDimension = {
    ...validAnalysisResult(),
    diagnosis: diagnosisWithoutLifecycle,
  };
  const blankConclusion = validAnalysisResult();
  blankConclusion.overall_judgement = '   ';
  const {
    overall_judgement: _missingOverallJudgement,
    ...missingConclusion
  } = validAnalysisResult();
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
    ['blank overall judgement', { ...validBody, result: blankConclusion }],
    ['missing overall judgement', { ...validBody, result: missingConclusion }],
    [
      'valid status with incomplete result',
      {
        ...validBody,
        result: { ...validAnalysisResult(), missing_inputs: ['fixture-source'] },
      },
    ],
    [
      'incomplete status with complete result',
      { ...validBody, analysis_status: 'incomplete' },
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
      'valid status with empty seven-dimensional evidence',
      {
        ...validBody,
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
      analysis_id: statusCode === 409 ? 'analysis-in-progress' : null,
      result: { message: `fixture ${coreStatus}` },
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
        const safeResponse = (error as InstanceType<typeof CoreResponseError>).response;
        assert.notStrictEqual(safeResponse, body);
        assert.notStrictEqual(safeResponse.result, body.result);
        assert.deepEqual(safeResponse, body);
        return true;
      },
    );
  }
});

test('refreshSku rejects malformed non-200 core response fields', async (context) => {
  const {
    CoreClient,
    CoreProtocolError,
  } = await import(moduleUrl.href);
  const validBody: Record<string, unknown> = {
    status: 'schema_invalid',
    request_id: 'req-422-invalid',
    analysis_id: null,
    result: { message: 'fixture schema failure' },
  };
  const cases: Array<[string, Record<string, unknown>]> = [
    ['missing status', { ...validBody, status: undefined }],
    ['wrong status type', { ...validBody, status: 422 }],
    ['success status', { ...validBody, status: 'success' }],
    ['missing request_id', { ...validBody, request_id: undefined }],
    ['wrong request_id type', { ...validBody, request_id: 422 }],
    ['missing analysis_id', { ...validBody, analysis_id: undefined }],
    ['blank analysis_id', { ...validBody, analysis_id: '   ' }],
    ['wrong analysis_id type', { ...validBody, analysis_id: 422 }],
    ['missing result', { ...validBody, result: undefined }],
    ['null result', { ...validBody, result: null }],
    ['wrong result type', { ...validBody, result: 'fixture failure' }],
    ['missing message', { ...validBody, result: {} }],
    ['blank message', { ...validBody, result: { message: '   ' } }],
    ['wrong message type', { ...validBody, result: { message: 422 } }],
    [
      'success-only analysis_status',
      { ...validBody, analysis_status: 'incomplete' },
    ],
    ['success-only model_name', { ...validBody, model_name: 'fixture-model' }],
    ['unknown top-level field', { ...validBody, prompt: 'must-not-pass' }],
  ];

  for (const [name, body] of cases) {
    await context.test(name, async () => {
      const client = new CoreClient({
        socketPath: '/tmp/test.sock',
        transport: async () => ({ status: 422, body }),
      });

      await assert.rejects(
        () => client.refreshSku({
          sku: 'SKU-1',
          requestId: 'req-422-invalid',
          actorId: 'user-1',
        }),
        CoreProtocolError,
      );
    });
  }
});

test('refreshSku rejects private fields nested in a non-200 core response', async () => {
  const {
    CoreClient,
    CoreProtocolError,
  } = await import(moduleUrl.href);
  const client = new CoreClient({
    socketPath: '/tmp/test.sock',
    transport: async () => ({
      status: 422,
      body: {
        status: 'schema_invalid',
        request_id: 'req-422-private',
        analysis_id: null,
        result: {
          message: 'fixture schema failure',
          private_prompt: 'must-not-pass',
          debug: { sql: 'must-not-pass' },
        },
      },
    }),
  });

  await assert.rejects(
    () => client.refreshSku({
      sku: 'SKU-1',
      requestId: 'req-422-private',
      actorId: 'user-1',
    }),
    CoreProtocolError,
  );
});
