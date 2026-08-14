import type { AiStoredStatus } from '../../../shared/ai3a';

export type AiDb = {
  query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
};

export type AiAnalysisRow = {
  analysis_id: string;
  sku: string;
  iso_year: number;
  iso_week: number;
  focus_batch_id: string | null;
  source_analysis_id: string | null;
  analysis_status: AiStoredStatus;
  model_name: string | null;
  prompt_version: string | null;
  schema_version: string;
  analysis_payload: unknown;
  raw_payload?: unknown;
  error_code: string | null;
  error_message: string | null;
  token_used: number | null;
  cost_usd: number | string | null;
  started_at: string | Date;
  finished_at: string | Date | null;
  created_at: string | Date;
};

export type AiTrendAnalysisRow = AiAnalysisRow & {
  record_count: number | string;
};

const USABLE_COLUMNS = `
  analysis_id::text,
  iso_year,
  iso_week,
  source_analysis_id::text,
  analysis_status,
  model_name,
  prompt_version,
  schema_version,
  analysis_payload,
  finished_at,
  created_at
`;

const ATTEMPT_COLUMNS = `
  analysis_id::text,
  analysis_status,
  model_name,
  error_code,
  token_used,
  cost_usd,
  started_at,
  finished_at,
  created_at
`;

function firstRow(rows: unknown[]): AiAnalysisRow | null {
  return (rows[0] as AiAnalysisRow | undefined) ?? null;
}

export class Ai3aRepository {
  constructor(private readonly db: AiDb) {}

  async latestUsable(sku: string): Promise<AiAnalysisRow | null> {
    return firstRow(await this.db.query(
      `SELECT ${USABLE_COLUMNS}
         FROM business_ext.sku_ai_analysis_v3
        WHERE sku = $1
          AND analysis_status IN ('valid','incomplete')
        ORDER BY created_at DESC, analysis_id DESC
        LIMIT 1`,
      [sku],
    ));
  }

  async latestAttempt(sku: string): Promise<AiAnalysisRow | null> {
    return firstRow(await this.db.query(
      `SELECT ${ATTEMPT_COLUMNS}
         FROM business_ext.sku_ai_analysis_v3
        WHERE sku = $1
        ORDER BY created_at DESC, analysis_id DESC
        LIMIT 1`,
      [sku],
    ));
  }

  async usableHistory(sku: string, limit = 104): Promise<AiAnalysisRow[]> {
    const normalizedLimit = Number.isFinite(limit) ? Math.trunc(limit) : 104;
    const boundedLimit = Math.min(104, Math.max(1, normalizedLimit));
    return await this.db.query(
      `SELECT ${USABLE_COLUMNS}
         FROM business_ext.sku_ai_analysis_v3
        WHERE sku = $1
          AND analysis_status IN ('valid','incomplete')
        ORDER BY created_at DESC, analysis_id DESC
        LIMIT $2`,
      [sku, boundedLimit],
    ) as AiAnalysisRow[];
  }

  async trendHistory(sku: string, limit = 26): Promise<AiTrendAnalysisRow[]> {
    const normalizedLimit = Number.isFinite(limit) ? Math.trunc(limit) : 26;
    const boundedLimit = Math.min(26, Math.max(1, normalizedLimit));
    return await this.db.query(
      `WITH ranked AS MATERIALIZED (
         SELECT analysis_id,
                iso_year,
                iso_week,
                source_analysis_id,
                analysis_status,
                model_name,
                prompt_version,
                schema_version,
                analysis_payload,
                finished_at,
                created_at,
                COUNT(*) OVER (PARTITION BY iso_year, iso_week)::int AS record_count,
                ROW_NUMBER() OVER (
                  PARTITION BY iso_year, iso_week
                  ORDER BY created_at DESC, analysis_id DESC
                ) AS week_rank
           FROM business_ext.sku_ai_analysis_v3
          WHERE sku = $1
            AND analysis_status IN ('valid','incomplete')
       ), latest_by_week AS MATERIALIZED (
         SELECT *
           FROM ranked
          WHERE week_rank = 1
          ORDER BY iso_year DESC, iso_week DESC
          LIMIT $2
       )
       SELECT ${USABLE_COLUMNS}, record_count
         FROM latest_by_week
        ORDER BY iso_year DESC, iso_week DESC`,
      [sku, boundedLimit],
    ) as AiTrendAnalysisRow[];
  }

  async generationHistory(sku: string): Promise<AiAnalysisRow[]> {
    return await this.db.query(
      `SELECT ${ATTEMPT_COLUMNS}
         FROM business_ext.sku_ai_analysis_v3
        WHERE sku = $1
        ORDER BY created_at DESC, analysis_id DESC
        LIMIT 20`,
      [sku],
    ) as AiAnalysisRow[];
  }

  async findUsableById(
    sku: string,
    analysisId: string,
  ): Promise<AiAnalysisRow | null> {
    return firstRow(await this.db.query(
      `SELECT ${USABLE_COLUMNS}
         FROM business_ext.sku_ai_analysis_v3
        WHERE sku = $1
          AND analysis_id = $2::uuid
          AND analysis_status IN ('valid','incomplete')
        LIMIT 1`,
      [sku, analysisId],
    ));
  }
}
