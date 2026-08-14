import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const trustedRequestId = /^[A-Za-z0-9._:-]{1,128}$/;

export type RequestContextState = {
  requestId: string;
  startedAt: number;
  phases: Record<string, number>;
  aborted: boolean;
};

declare global {
  namespace Express {
    interface Request {
      requestContext?: RequestContextState;
    }
  }
}

export function resolveRequestId(value: unknown): string {
  return typeof value === "string" && trustedRequestId.test(value)
    ? value
    : randomUUID();
}

type RequestLogInput = {
  requestId: string;
  method: string;
  path: string;
  role: string;
  statusCode: number;
  durationMs: number;
  aborted: boolean;
  phases: Record<string, number>;
};

export function createRequestLog(input: RequestLogInput) {
  const phases = Object.fromEntries(
    Object.entries(input.phases).map(([name, durationMs]) => [
      name,
      Math.round(durationMs),
    ]),
  );
  return {
    request_id: input.requestId,
    method: input.method,
    path: input.path,
    role: input.role,
    status_code: input.statusCode,
    duration_ms: Math.round(input.durationMs),
    aborted: input.aborted,
    phases,
  };
}

export function requestContext(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestId = resolveRequestId(req.get("X-Request-ID"));
  const state: RequestContextState = {
    requestId,
    startedAt: performance.now(),
    phases: {},
    aborted: false,
  };
  req.requestContext = state;
  res.setHeader("X-Request-ID", requestId);

  res.once("close", () => {
    if (!res.writableEnded) state.aborted = true;
  });
  res.once("finish", () => {
    if (!req.path.startsWith("/api")) return;
    console.log(JSON.stringify(createRequestLog({
      requestId,
      method: req.method,
      path: req.path,
      role: req.session?.user?.role ?? "anonymous",
      statusCode: res.statusCode,
      durationMs: performance.now() - state.startedAt,
      aborted: state.aborted,
      phases: state.phases,
    })));
  });

  next();
}

export function recordPhase(
  req: Request,
  name: string,
  durationMs: number,
): void {
  if (!req.requestContext) return;
  req.requestContext.phases[name] = Math.round(durationMs);
}
