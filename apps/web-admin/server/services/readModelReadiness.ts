import type { Query } from "./operatingFieldsSource";

export type TaskCandidateFilter = {
  sql: string;
  params: unknown[];
};

export function buildReadModelReadinessSql(
  filterSql: string,
  contractPlaceholder: string,
): string {
  return `
    WITH candidate_skus AS (
      SELECT DISTINCT t.sku
        FROM business.ops_task t
        LEFT JOIN business.sku_master s ON s.sku = t.sku
        LEFT JOIN middleware.mkd_customer_product mp ON mp.sku = t.sku
       WHERE ${filterSql}
    ), latest_etl AS (
      SELECT finished_at,
             EXTRACT(ISOYEAR FROM window_end)::int AS metric_iso_year,
             EXTRACT(WEEK FROM window_end)::int AS metric_iso_week
        FROM business_ext.etl_run_log
       WHERE job_name = 'seven_fields_weekly'
         AND status = 'success'
         AND finished_at IS NOT NULL
         AND window_end IS NOT NULL
       ORDER BY window_end DESC, finished_at DESC, run_id DESC
       LIMIT 1
    )
    SELECT NOT EXISTS (
      SELECT 1
        FROM candidate_skus candidate
        LEFT JOIN latest_etl ON true
        LEFT JOIN business_ext.sku_operation_read_model read_model
          ON read_model.sku = candidate.sku
        LEFT JOIN business_ext.focus_sku_batch focus_batch
          ON focus_batch.batch_id = read_model.focus_batch_id
       WHERE latest_etl.finished_at IS NULL
          OR read_model.sku IS NULL
          OR focus_batch.status IS DISTINCT FROM 'success'
          OR read_model.contract_version IS DISTINCT FROM ${contractPlaceholder}
          OR read_model.metric_iso_year IS DISTINCT FROM latest_etl.metric_iso_year
          OR read_model.metric_iso_week IS DISTINCT FROM latest_etl.metric_iso_week
          OR read_model.source_updated_at IS NULL
          OR read_model.source_updated_at < latest_etl.finished_at
    ) AS ready
  `;
}

export async function checkReadModelReadiness(
  query: Query,
  filter: TaskCandidateFilter,
  contractVersion: string,
): Promise<boolean> {
  const params = [...filter.params, contractVersion];
  const contractPlaceholder = `$${params.length}`;
  const rows = await query<{ ready: boolean }>(
    buildReadModelReadinessSql(filter.sql, contractPlaceholder),
    params,
  );
  return rows[0]?.ready === true;
}
