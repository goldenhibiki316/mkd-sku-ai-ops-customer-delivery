import { z } from "zod";

import { rawApiRequest } from "@/lib/queryClient";
import {
  aiAnalysisResponseSchema,
  aiHistoryDetailResponseSchema,
  aiHistoryResponseSchema,
  type AiAnalysisResponse,
  type AiHistoryDetailResponse,
  type AiHistoryResponse,
} from "@shared/ai3a";

type AiClientErrorCode =
  | "AI_AUTH_REQUIRED"
  | "AI_ACCESS_FORBIDDEN"
  | "AI_GENERATION_IN_PROGRESS"
  | "AI_NETWORK_ERROR"
  | "AI_REQUEST_FAILED"
  | "AI_RESPONSE_INVALID";

const safeMessages: Record<AiClientErrorCode, string> = {
  AI_AUTH_REQUIRED: "登录状态已失效，请重新登录",
  AI_ACCESS_FORBIDDEN: "当前账号无权访问 AI 分析",
  AI_GENERATION_IN_PROGRESS: "该 SKU 的分析正在生成，请稍后刷新",
  AI_NETWORK_ERROR: "AI 分析网络请求失败，请稍后重试",
  AI_REQUEST_FAILED: "AI 分析服务暂时不可用，请稍后重试",
  AI_RESPONSE_INVALID: "AI 分析返回内容异常，请稍后重试",
};

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}

export class AiClientResponseError extends Error {
  constructor(
    readonly code: AiClientErrorCode,
    readonly status: number | null = null,
  ) {
    super(safeMessages[code]);
    this.name = "AiClientResponseError";
  }
}

const aiRefreshSuccessSchema = z.object({
  analysis_id: z.string(),
  status: z.literal("success"),
  analysis_status: z.enum(["valid", "incomplete"]),
  model_name: z.string(),
  result: z.unknown(),
});

export type AiRefreshSuccess = z.infer<typeof aiRefreshSuccessSchema>;

async function releaseBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // The classified client error remains the public error boundary.
  }
}

async function parseResponse<Schema extends z.ZodTypeAny>(
  response: Response,
  schema: Schema,
): Promise<z.output<Schema>> {
  if (!response.ok) {
    await releaseBody(response);
    if (response.status === 401) {
      throw new AiClientResponseError("AI_AUTH_REQUIRED", response.status);
    }
    if (response.status === 403) {
      throw new AiClientResponseError("AI_ACCESS_FORBIDDEN", response.status);
    }
    if (response.status === 409) {
      throw new AiClientResponseError(
        "AI_GENERATION_IN_PROGRESS",
        response.status,
      );
    }
    throw new AiClientResponseError("AI_REQUEST_FAILED", response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new AiClientResponseError("AI_RESPONSE_INVALID", response.status);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AiClientResponseError("AI_RESPONSE_INVALID", response.status);
  }
  return parsed.data;
}

async function request<Schema extends z.ZodTypeAny>(
  method: "GET" | "POST",
  url: string,
  schema: Schema,
  signal?: AbortSignal,
): Promise<z.output<Schema>> {
  let response: Response;
  try {
    response = await rawApiRequest(method, url, undefined, signal);
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new AiClientResponseError("AI_NETWORK_ERROR");
  }
  return parseResponse(response, schema);
}

export function parseAiAnalysisResponse(
  response: Response,
): Promise<AiAnalysisResponse> {
  return parseResponse(response, aiAnalysisResponseSchema);
}

export function parseAiRefreshResponse(
  response: Response,
): Promise<AiRefreshSuccess> {
  return parseResponse(response, aiRefreshSuccessSchema);
}

export function getAiAnalysis(
  sku: string,
  signal?: AbortSignal,
): Promise<AiAnalysisResponse> {
  return request(
    "GET",
    `/api/skus/${encodeURIComponent(sku)}/ai-analysis`,
    aiAnalysisResponseSchema,
    signal,
  );
}

export function getAiHistory(
  sku: string,
  signal?: AbortSignal,
): Promise<AiHistoryResponse> {
  return request(
    "GET",
    `/api/skus/${encodeURIComponent(sku)}/ai/history`,
    aiHistoryResponseSchema,
    signal,
  );
}

export function getAiHistoryDetail(
  sku: string,
  analysisId: string,
  signal?: AbortSignal,
): Promise<AiHistoryDetailResponse> {
  return request(
    "GET",
    `/api/skus/${encodeURIComponent(sku)}/ai/history/${encodeURIComponent(analysisId)}`,
    aiHistoryDetailResponseSchema,
    signal,
  );
}

export function refreshAiAnalysis(sku: string): Promise<AiRefreshSuccess> {
  return request(
    "POST",
    `/api/skus/${encodeURIComponent(sku)}/ai-refresh`,
    aiRefreshSuccessSchema,
  );
}
