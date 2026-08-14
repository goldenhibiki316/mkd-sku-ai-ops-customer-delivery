// PostgreSQL 连接池 — 通过 SSH 隧道访问 RDS (localhost:15432)
// 所有凭据必须来自环境变量;运行前必须 source .env(见 .env.example)
import { readFileSync } from "node:fs";
import pg from "pg";
import type { Query } from "./services/operatingFieldsSource";

if (!process.env.PGPASSWORD) {
  throw new Error(
    "[pg] PGPASSWORD is required. Copy .env.example to .env and fill in real values, or export PGPASSWORD before starting the server."
  );
}

export function resolveWebDatabaseSsl(
  env: NodeJS.ProcessEnv = process.env,
  readCertificate: (certPath: string) => string = (certPath) =>
    readFileSync(certPath, "utf8"),
): pg.PoolConfig["ssl"] {
  const mode = (env.PGSSLMODE || "").trim().toLowerCase();
  if (!mode || ["disable", "false", "0"].includes(mode)) return false;

  const certPath = env.PGSSLROOTCERT?.trim();
  if (!certPath) {
    throw new Error(
      "PGSSLROOTCERT is required when PGSSLMODE is enabled",
    );
  }

  return {
    ca: readCertificate(certPath),
    rejectUnauthorized: true,
  };
}

const pool = new pg.Pool({
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT || 15432),
  user: process.env.PGUSER || "ai_app",
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || "mkd_sku_ai_dev",
  ssl: resolveWebDatabaseSsl(),
  max: 8,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("[pg] pool error:", err.message);
});

export type QueryTiming = {
  pool_wait_ms: number;
  query_ms: number;
};

export async function timedQuery<T = unknown>(
  targetPool: pg.Pool,
  sql: string,
  params: unknown[] = [],
  report?: (timing: QueryTiming) => void,
  now: () => number = () => performance.now(),
): Promise<T[]> {
  const waitStartedAt = now();
  const client = await targetPool.connect();
  const connectedAt = now();
  try {
    const result = await client.query(sql, params);
    report?.({
      pool_wait_ms: Math.round(connectedAt - waitStartedAt),
      query_ms: Math.round(now() - connectedAt),
    });
    return result.rows as T[];
  } finally {
    client.release();
  }
}

async function connectWithTiming(
  targetPool: pg.Pool,
  operation: string,
): Promise<pg.PoolClient> {
  const startedAt = Date.now();
  const client = await targetPool.connect();
  const poolWaitMs = Date.now() - startedAt;
  if (poolWaitMs >= 100) {
    console.warn(`[pg] pool_wait_ms=${poolWaitMs} operation=${operation}`);
  }
  return client;
}

function logClientCleanupFailure(
  operation: string,
  cleanup: "rollback" | "release",
  error: unknown,
): void {
  console.error(`[pg] ${operation} ${cleanup}_failed:`, error);
}

export async function q<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const client = await connectWithTiming(pool, "query");
  try {
    const res = await client.query(sql, params);
    return res.rows as T[];
  } finally {
    client.release();
  }
}

function resolveReadQueryTimeoutMs(): number {
  const configured = Number(process.env.READ_QUERY_TIMEOUT_MS || 15000);
  return Number.isFinite(configured) && configured > 0
    ? Math.round(configured)
    : 15000;
}

export async function qRead<T = unknown>(
  sql: string,
  params: unknown[] = [],
  timeoutMs: number = resolveReadQueryTimeoutMs(),
  targetPool: pg.Pool = pool,
): Promise<T[]> {
  const client = await connectWithTiming(targetPool, "read-query");
  let rollbackFailed = false;
  try {
    await client.query("BEGIN READ ONLY");
    await client.query(
      "SELECT set_config('statement_timeout', $1, true)",
      [`${timeoutMs}ms`],
    );
    const result = await client.query(sql, params as any[]);
    await client.query("COMMIT");
    return result.rows as T[];
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      rollbackFailed = true;
      logClientCleanupFailure("read-query", "rollback", rollbackError);
    }
    throw error;
  } finally {
    if (rollbackFailed) client.release(true);
    else client.release();
  }
}

export async function withReadOnlyRepeatableRead<T>(
  work: (query: Query) => Promise<T>,
  targetPool: pg.Pool = pool,
): Promise<T> {
  const client = await connectWithTiming(
    targetPool,
    "read-only-repeatable-read",
  );
  const query: Query = async <Row = unknown>(
    sql: string,
    params: unknown[] = [],
  ): Promise<Row[]> => {
    const result = await client.query(sql, params as any[]);
    return result.rows as Row[];
  };
  let hasPrimaryError = false;
  let rollbackFailed = false;

  try {
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    await client.query(
      "SELECT set_config('statement_timeout', $1, true)",
      [`${resolveReadQueryTimeoutMs()}ms`],
    );
    const result = await work(query);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    hasPrimaryError = true;
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      rollbackFailed = true;
      logClientCleanupFailure(
        "read-only-repeatable-read",
        "rollback",
        rollbackError,
      );
    }
    throw error;
  } finally {
    let releaseCleanupFailed = false;
    let releaseCleanupError: unknown;
    try {
      if (rollbackFailed) client.release(true);
      else client.release();
    } catch (error) {
      releaseCleanupFailed = true;
      releaseCleanupError = error;
      logClientCleanupFailure(
        "read-only-repeatable-read",
        "release",
        error,
      );
    }
    if (releaseCleanupFailed && !hasPrimaryError) throw releaseCleanupError;
  }
}

export { pool };
