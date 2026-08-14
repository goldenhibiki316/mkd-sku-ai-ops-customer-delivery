import { QueryClient, QueryFunction } from "@tanstack/react-query";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

type ApiErrorOptions = {
  status: number;
  message: string;
  code?: string;
  retryable?: boolean;
  request_id?: string;
  last_page?: number;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryable?: boolean;
  readonly request_id?: string;
  readonly last_page?: number;

  constructor(options: ApiErrorOptions) {
    super(options.message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.retryable = options.retryable;
    this.request_id = options.request_id;
    this.last_page = options.last_page;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export async function responseToApiError(res: Response): Promise<ApiError> {
  const text = (await res.text()) || res.statusText;
  const headerRequestId = res.headers.get("X-Request-ID") ?? undefined;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }

  const detail = isRecord(body) && isRecord(body.error) ? body.error : null;
  if (detail && typeof detail.message === "string") {
    return new ApiError({
      status: res.status,
      message: detail.message,
      code: typeof detail.code === "string" ? detail.code : undefined,
      retryable: typeof detail.retryable === "boolean"
        ? detail.retryable
        : undefined,
      request_id: typeof detail.request_id === "string"
        ? detail.request_id
        : headerRequestId,
      last_page: Number.isInteger(detail.last_page) && Number(detail.last_page) >= 1
        ? Number(detail.last_page)
        : undefined,
    });
  }

  return new ApiError({
    status: res.status,
    message: `${res.status}: ${text}`,
    request_id: headerRequestId,
  });
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    throw await responseToApiError(res);
  }
}

export async function rawApiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(`${API_BASE}${url}`, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include", // v1.6 带上 session cookie
    signal,
  });
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  signal?: AbortSignal,
): Promise<Response> {
  const res = await rawApiRequest(method, url, data, signal);

  // 不对 401 抛错 —— 让调用方自己处理(登录/auth me/任务拉取等)
  if (!res.ok && res.status !== 401 && res.status !== 403) {
    await throwIfResNotOk(res);
  }
  return res;
}

export async function getJSON<T>(
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    credentials: "include",
    signal,
  });
  await throwIfResNotOk(res);
  return await res.json() as T;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey, signal }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`, {
      credentials: "include", // v1.6 带上 session cookie
      signal,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
