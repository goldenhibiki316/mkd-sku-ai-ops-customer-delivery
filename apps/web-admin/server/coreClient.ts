import { request as httpRequest } from 'node:http';
import { z } from 'zod';

import {
  generatedAnalysisResultSchema,
  type GeneratedAnalysisResult,
} from './services/ai3a/generatedResultSchema';
import { normalizeAiPayload } from './services/ai3a/payloadNormalizer';

export type CoreTransportRequest = {
  method: 'POST';
  path: string;
  body: Record<string, string>;
};

export type CoreTransportResponse = {
  status: number;
  body: unknown;
};

export type CoreTransport = (
  request: CoreTransportRequest,
) => Promise<CoreTransportResponse>;

export type CoreClientOptions = {
  socketPath: string;
  timeoutMs?: number;
  transport?: CoreTransport;
};

export type RefreshSkuInput = {
  sku: string;
  requestId: string;
  actorId: string;
};

export type CoreResponse = {
  status: string;
  request_id: string;
  analysis_id?: unknown;
  analysis_status?: unknown;
  model_name?: unknown;
  result?: unknown;
};

export type RefreshSkuResponse = CoreResponse & {
  status: 'success';
  analysis_id: string;
  analysis_status: 'valid' | 'incomplete';
  model_name: string;
  result: GeneratedAnalysisResult;
};

export type CoreErrorResponse = {
  status:
    | 'invalid_request'
    | 'not_found'
    | 'generating'
    | 'schema_invalid'
    | 'internal_error'
    | 'model_failed';
  request_id: string;
  analysis_id: string | null;
  result: { message: string };
};

export class CoreUnavailableError extends Error {
  constructor(message = 'proprietary core is unavailable') {
    super(message);
    this.name = 'CoreUnavailableError';
  }
}

export class CoreProtocolError extends Error {
  constructor(message = 'proprietary core returned an invalid response') {
    super(message);
    this.name = 'CoreProtocolError';
  }
}

export class CoreResponseError extends Error {
  constructor(
    readonly statusCode: number,
    readonly response: CoreErrorResponse,
  ) {
    super(`proprietary core returned ${statusCode}`);
    this.name = 'CoreResponseError';
  }
}

const approvedStatusContract = new Map<number, string>([
  [200, 'success'],
  [400, 'invalid_request'],
  [404, 'not_found'],
  [409, 'generating'],
  [422, 'schema_invalid'],
  [500, 'internal_error'],
  [502, 'model_failed'],
]);
const approvedResponseFields = new Set([
  'status',
  'request_id',
  'analysis_id',
  'analysis_status',
  'model_name',
  'result',
]);
const coreErrorResponseSchema = z.object({
  status: z.enum([
    'invalid_request',
    'not_found',
    'generating',
    'schema_invalid',
    'internal_error',
    'model_failed',
  ]),
  request_id: z.string().min(1),
  analysis_id: z.string().trim().min(1).nullable(),
  result: z.object({
    message: z.string().trim().min(1),
  }).strict(),
}).strict();

function requiredIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${field} is required`);
  if (normalized.length > 128) throw new TypeError(`${field} is too long`);
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseCoreResponse(body: unknown): CoreResponse {
  if (!isRecord(body)) throw new CoreProtocolError();
  if (Object.keys(body).some((field) => !approvedResponseFields.has(field))) {
    throw new CoreProtocolError('core response contains an unapproved field');
  }
  const status = body.status;
  const requestId = body.request_id;
  if (typeof status !== 'string' || typeof requestId !== 'string') {
    throw new CoreProtocolError();
  }
  const parsed: CoreResponse = { status, request_id: requestId };
  for (const field of ['analysis_id', 'analysis_status', 'model_name', 'result'] as const) {
    if (Object.hasOwn(body, field)) parsed[field] = body[field];
  }
  return parsed;
}

function parseCoreErrorResponse(body: unknown): CoreErrorResponse {
  const parsed = coreErrorResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new CoreProtocolError('core error response does not satisfy the strict contract');
  }
  return {
    status: parsed.data.status,
    request_id: parsed.data.request_id,
    analysis_id: parsed.data.analysis_id,
    result: { message: parsed.data.result.message },
  };
}

function parseRefreshSkuSuccess(
  body: CoreResponse,
  expectedRequestId: string,
): RefreshSkuResponse {
  const analysisId = body.analysis_id;
  const analysisStatus = body.analysis_status;
  const modelName = body.model_name;
  const result = body.result;
  if (
    body.request_id !== expectedRequestId
    || typeof analysisId !== 'string'
    || !analysisId.trim()
    || (analysisStatus !== 'valid' && analysisStatus !== 'incomplete')
    || typeof modelName !== 'string'
    || !modelName.trim()
  ) {
    throw new CoreProtocolError();
  }
  const parsedResult = generatedAnalysisResultSchema.safeParse(result);
  if (!parsedResult.success) {
    throw new CoreProtocolError('core result does not satisfy the strict 3A.1 contract');
  }
  const safeResult = parsedResult.data;
  try {
    const normalized = normalizeAiPayload(safeResult, {
      source: 'generated',
      modelName: modelName.trim(),
      promptVersion: null,
    });
    if (normalized.status !== analysisStatus) {
      throw new CoreProtocolError('core result status is inconsistent');
    }
  } catch (error) {
    if (error instanceof CoreProtocolError) throw error;
    throw new CoreProtocolError('core result does not satisfy the 3A.1 contract');
  }
  return {
    status: 'success',
    request_id: expectedRequestId,
    analysis_id: analysisId.trim(),
    analysis_status: analysisStatus,
    model_name: modelName.trim(),
    result: safeResult,
  };
}

function defaultTransport(
  socketPath: string,
  timeoutMs: number,
): CoreTransport {
  return ({ method, path, body }) => new Promise((resolve, reject) => {
    const encoded = Buffer.from(JSON.stringify(body), 'utf8');
    const request = httpRequest({
      socketPath,
      path,
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': encoded.byteLength,
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 64 * 1024) {
          request.destroy(new CoreProtocolError('core response exceeds 64 KiB'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          const responseBody = text ? JSON.parse(text) : {};
          resolve({ status: response.statusCode ?? 502, body: responseBody });
        } catch {
          reject(new CoreProtocolError('core response is not valid JSON'));
        }
      });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new CoreUnavailableError('core request timed out'));
    });
    request.on('error', (error) => {
      if (error instanceof CoreProtocolError || error instanceof CoreUnavailableError) {
        reject(error);
        return;
      }
      reject(new CoreUnavailableError());
    });
    request.end(encoded);
  });
}

export class CoreClient {
  private readonly transport: CoreTransport;

  constructor(options: CoreClientOptions) {
    const socketPath = options.socketPath.trim();
    if (!socketPath) throw new TypeError('socketPath is required');
    const timeoutMs = options.timeoutMs ?? 5_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError('timeoutMs must be positive');
    }
    this.transport = options.transport ?? defaultTransport(socketPath, timeoutMs);
  }

  async refreshSku(input: RefreshSkuInput): Promise<RefreshSkuResponse> {
    const requestId = requiredIdentifier(input.requestId, 'requestId');
    const response = await this.transport({
      method: 'POST',
      path: '/v1/sku-analysis/refresh',
      body: {
        sku: requiredIdentifier(input.sku, 'sku'),
        request_id: requestId,
        actor_id: requiredIdentifier(input.actorId, 'actorId'),
      },
    });

    if (response.status === 503) {
      throw new CoreUnavailableError('core is temporarily unavailable');
    }
    const expectedStatus = approvedStatusContract.get(response.status);
    if (!expectedStatus) {
      throw new CoreProtocolError('core returned an unapproved HTTP status');
    }
    if (response.status !== 200) {
      const parsedError = parseCoreErrorResponse(response.body);
      if (parsedError.request_id !== requestId) {
        throw new CoreProtocolError('core response request_id does not match');
      }
      if (parsedError.status !== expectedStatus) {
        throw new CoreProtocolError('core HTTP status and response status disagree');
      }
      throw new CoreResponseError(response.status, parsedError);
    }
    const parsed = parseCoreResponse(response.body);
    if (parsed.request_id !== requestId) {
      throw new CoreProtocolError('core response request_id does not match');
    }
    if (parsed.status !== expectedStatus) {
      throw new CoreProtocolError('core HTTP status and response status disagree');
    }
    return parseRefreshSkuSuccess(parsed, requestId);
  }
}

export function createCoreClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): CoreClient {
  return new CoreClient({
    socketPath: env.MKD_CORE_SOCKET?.trim() || '/run/mkd-core/core.sock',
    timeoutMs: Number(env.MKD_CORE_TIMEOUT_MS || 190_000),
  });
}
