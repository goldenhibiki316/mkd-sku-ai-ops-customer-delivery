import { request as httpRequest } from 'node:http';

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

export type RefreshSkuResponse = {
  status: string;
  request_id: string;
} & Record<string, unknown>;

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

function requiredIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${field} is required`);
  if (normalized.length > 128) throw new TypeError(`${field} is too long`);
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
    const response = await this.transport({
      method: 'POST',
      path: '/v1/sku-analysis/refresh',
      body: {
        sku: requiredIdentifier(input.sku, 'sku'),
        request_id: requiredIdentifier(input.requestId, 'requestId'),
        actor_id: requiredIdentifier(input.actorId, 'actorId'),
      },
    });

    if (response.status < 200 || response.status >= 300) {
      throw new CoreUnavailableError(`core request failed with status ${response.status}`);
    }
    if (!isRecord(response.body)) throw new CoreProtocolError();
    const status = response.body.status;
    const requestId = response.body.request_id;
    if (typeof status !== 'string' || typeof requestId !== 'string') {
      throw new CoreProtocolError();
    }
    return { ...response.body, status, request_id: requestId };
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
