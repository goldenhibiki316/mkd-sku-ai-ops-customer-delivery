import type {
  ErrorRequestHandler,
  NextFunction,
  Response,
} from "express";
import { resolveRequestId } from "./requestContext";

export class AppHttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    retryable = false,
  ) {
    super(message);
    this.name = "AppHttpError";
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = retryable;
  }
}

export class TaskReadModelRefreshingError extends AppHttpError {
  constructor() {
    super(
      503,
      "TASK_READ_MODEL_REFRESHING",
      "数据刷新中，请稍后重试",
      true,
    );
    this.name = "TaskReadModelRefreshingError";
  }
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error ?? "Internal Server Error");

function databaseErrorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
}

export function toAppHttpError(error: unknown): AppHttpError {
  if (error instanceof AppHttpError) return error;
  const code = databaseErrorCode(error);
  if (code === "57014") {
    return new AppHttpError(
      504,
      "UPSTREAM_TIMEOUT",
      "数据加载超时，请重新加载",
      true,
    );
  }
  if (code.startsWith("08")) {
    return new AppHttpError(
      503,
      "DATABASE_UNAVAILABLE",
      "数据服务暂时不可用，请重新加载",
      true,
    );
  }
  return new AppHttpError(
    500,
    "INTERNAL_ERROR",
    "服务暂时不可用，请稍后重试",
    true,
  );
}

export function safeServerError(error: unknown) {
  return {
    name: error instanceof Error ? error.name : "UnknownError",
    code: error instanceof AppHttpError
      ? error.code
      : databaseErrorCode(error) || "INTERNAL_ERROR",
  };
}

export function handleTaskRouteError(
  error: unknown,
  _res: Response,
  next: NextFunction,
) {
  return next(error);
}

export const appErrorHandler: ErrorRequestHandler = (
  error,
  req,
  res,
  next,
) => {
  if (res.headersSent) return next(error);

  const apiError = toAppHttpError(error);
  const rawRequestId = req.headers?.["x-request-id"];
  const requestId = req.requestContext?.requestId ?? resolveRequestId(
    Array.isArray(rawRequestId) ? rawRequestId[0] : rawRequestId,
  );
  console.error(JSON.stringify({
    level: "error",
    request_id: requestId,
    code: apiError.code,
    error: safeServerError(error),
  }));
  const lastPage = Number(
    (apiError as AppHttpError & { lastPage?: unknown }).lastPage,
  );
  return res.status(apiError.statusCode).json({
    error: {
      code: apiError.code,
      message: apiError.message,
      retryable: apiError.retryable,
      request_id: requestId,
      ...(Number.isInteger(lastPage) && lastPage >= 1
        ? { last_page: lastPage }
        : {}),
    },
  });
};
