import {
  taskSkuOperatingFieldsSchema,
  type TaskSkuOperatingFields,
} from "../../shared/taskOperating";

export type Query = <T = unknown>(
  sql: string,
  params?: unknown[],
) => Promise<T[]>;

export type ReadModelOperatingFields = TaskSkuOperatingFields & {
  contract_version: string;
  focus_batch_id: string;
};

export const READ_MODEL_FIELDS_SQL = `
  WITH latest_successful_etl AS (
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
  SELECT read_model.sku,
         read_model.product_name,
         read_model.image_url,
         read_model.brand_name,
         read_model.primary_shop,
         read_model.type_code AS current_type_code,
         read_model.type_name,
         read_model.type_color,
         read_model.metric_iso_year,
         read_model.metric_iso_week,
         read_model.weekly_gmv,
         read_model.weekly_gmv_status,
         read_model.profit_margin,
         read_model.profit_margin_status,
         read_model.turnover_days,
         read_model.turnover_status,
         read_model.claim_rate,
         read_model.claim_rate_status,
         read_model.contract_version,
         read_model.focus_batch_id::text
    FROM business_ext.sku_operation_read_model read_model
    JOIN business_ext.focus_sku_batch focus_batch
      ON focus_batch.batch_id = read_model.focus_batch_id
     AND focus_batch.status = 'success'
     AND focus_batch.finished_at IS NOT NULL
   CROSS JOIN latest_successful_etl etl
   WHERE read_model.sku = ANY($1::text[])
     AND read_model.contract_version = $2
     AND read_model.metric_iso_year = etl.metric_iso_year
     AND read_model.metric_iso_week = etl.metric_iso_week
     AND read_model.source_updated_at >= etl.finished_at
`;

export const BATCH_OPERATING_FIELDS_SQL = `
  WITH requested AS MATERIALIZED (
    SELECT requested.sku
      FROM unnest($1::text[]) AS requested(sku)
  ), latest_classification AS MATERIALIZED (
    SELECT DISTINCT ON (requested.sku)
           requested.sku,
           c.iso_year,
           c.iso_week,
           c.weekly_gmv,
           c.claim_rate,
           COALESCE(
             c.evidence_json ->> 'gmv_source_status',
             metrics.anomaly_flags ->> 'gmv_source_status'
           ) AS gmv_source_status,
           metrics.weekly_orders
      FROM requested
      LEFT JOIN business.sku_weekly_classification c
        ON c.sku = requested.sku
      LEFT JOIN business.sku_weekly_metrics metrics
        ON metrics.sku = c.sku
       AND metrics.iso_year = c.iso_year
       AND metrics.iso_week = c.iso_week
     ORDER BY requested.sku, c.iso_year DESC, c.iso_week DESC
  ), latest_operating_metrics AS MATERIALIZED (
    SELECT latest.sku,
           latest.iso_year,
           latest.iso_week,
           latest.weekly_gmv,
           latest.claim_rate,
           latest.gmv_source_status,
           latest.weekly_orders,
           margin.gross_margin_v2,
           turnover.inv_qty,
           turnover.inv_turnover_days_calc
      FROM latest_classification latest
      LEFT JOIN business_ext.sku_weekly_derived_v2 margin
        ON margin.sku = latest.sku
       AND margin.iso_year = latest.iso_year
       AND margin.iso_week = latest.iso_week
      LEFT JOIN business_ext.sku_weekly_full_v turnover
        ON turnover.sku = latest.sku
       AND turnover.iso_year = latest.iso_year
       AND turnover.iso_week = latest.iso_week
  )
  SELECT requested.sku,
         COALESCE(
           NULLIF(mp.chinese_name, ''),
           mp.title,
           s.product_name_zh,
           '(未命名 ' || s.sku || ')'
         ) AS product_name,
         NULLIF(mp.image_url, '') AS image_url,
         s.brand_name,
         s.primary_shop,
         s.current_type_code,
         d.name_zh AS type_name,
         d.display_color AS type_color,
         latest.iso_year AS metric_iso_year,
         latest.iso_week AS metric_iso_week,
         latest.weekly_gmv,
         latest.gross_margin_v2 AS profit_margin,
         latest.inv_turnover_days_calc AS turnover_days,
         latest.claim_rate,
         CASE
           WHEN latest.gmv_source_status = 'partial' THEN 'source_partial'
           WHEN latest.gmv_source_status = 'missing' OR latest.weekly_gmv IS NULL THEN 'source_missing'
           ELSE 'observed'
         END AS weekly_gmv_status,
         CASE
           WHEN latest.gmv_source_status = 'partial' THEN 'source_partial'
           WHEN latest.gmv_source_status = 'missing' THEN 'source_missing'
           WHEN latest.weekly_gmv = 0 THEN 'no_sales'
           WHEN latest.gross_margin_v2 IS NULL THEN 'missing_profit'
           ELSE 'observed'
         END AS profit_margin_status,
         CASE
           WHEN latest.inv_qty IS NULL THEN 'missing_inventory'
           WHEN latest.inv_qty = 0 THEN 'no_inventory'
           WHEN latest.gmv_source_status = 'partial' THEN 'source_partial'
           WHEN latest.gmv_source_status = 'missing' THEN 'source_missing'
           WHEN latest.inv_turnover_days_calc IS NULL THEN 'missing_inventory'
           ELSE 'observed'
         END AS turnover_status,
         CASE
           WHEN latest.weekly_orders IS NULL THEN 'missing'
           WHEN latest.weekly_orders = 0 THEN 'no_effective_orders'
           WHEN latest.claim_rate IS NULL THEN 'missing'
           ELSE 'observed'
         END AS claim_rate_status
    FROM requested
    LEFT JOIN business.sku_master s ON s.sku = requested.sku
    LEFT JOIN middleware.mkd_customer_product mp ON mp.sku = requested.sku
    LEFT JOIN business.sku_type_dict d ON d.type_code = s.current_type_code
    LEFT JOIN latest_operating_metrics latest ON latest.sku = requested.sku
`;

export const ETL_SNAPSHOT_OPERATING_FIELDS_SQL = `
  WITH requested AS MATERIALIZED (
    SELECT requested.sku
      FROM unnest($1::text[]) AS requested(sku)
  ), latest_classification AS MATERIALIZED (
    SELECT DISTINCT ON (requested.sku)
           requested.sku,
           c.iso_year,
           c.iso_week,
           c.weekly_gmv,
           c.profit_margin,
           c.turnover_days,
           c.claim_rate,
           c.evidence_json,
           COALESCE(
             c.evidence_json ->> 'gmv_source_status',
             metrics.anomaly_flags ->> 'gmv_source_status'
           ) AS gmv_source_status,
           metrics.weekly_orders
      FROM requested
      LEFT JOIN business.sku_weekly_classification c
        ON c.sku = requested.sku
      LEFT JOIN business.sku_weekly_metrics metrics
        ON metrics.sku = c.sku
       AND metrics.iso_year = c.iso_year
       AND metrics.iso_week = c.iso_week
     ORDER BY requested.sku, c.iso_year DESC, c.iso_week DESC
  )
  SELECT requested.sku,
         COALESCE(
           NULLIF(mp.chinese_name, ''),
           mp.title,
           s.product_name_zh,
           '(未命名 ' || s.sku || ')'
         ) AS product_name,
         NULLIF(mp.image_url, '') AS image_url,
         s.brand_name,
         s.primary_shop,
         s.current_type_code,
         d.name_zh AS type_name,
         d.display_color AS type_color,
         latest.iso_year AS metric_iso_year,
         latest.iso_week AS metric_iso_week,
         latest.weekly_gmv,
         latest.profit_margin AS profit_margin,
         latest.turnover_days AS turnover_days,
         latest.claim_rate,
         COALESCE(
           latest.evidence_json ->> 'weekly_gmv_status',
           CASE
             WHEN latest.gmv_source_status = 'partial' THEN 'source_partial'
             WHEN latest.gmv_source_status = 'missing' OR latest.weekly_gmv IS NULL THEN 'source_missing'
             ELSE 'observed'
           END
         ) AS weekly_gmv_status,
         COALESCE(
           latest.evidence_json ->> 'profit_margin_status',
           CASE
             WHEN latest.gmv_source_status = 'partial' THEN 'source_partial'
             WHEN latest.gmv_source_status = 'missing' THEN 'source_missing'
             WHEN latest.weekly_gmv = 0 THEN 'no_sales'
             WHEN latest.profit_margin IS NULL THEN 'missing_profit'
             ELSE 'observed'
           END
         ) AS profit_margin_status,
         COALESCE(
           latest.evidence_json ->> 'turnover_status',
           CASE
             WHEN latest.gmv_source_status = 'partial' THEN 'source_partial'
             WHEN latest.gmv_source_status = 'missing' THEN 'source_missing'
             WHEN latest.turnover_days IS NULL THEN 'missing_inventory'
             ELSE 'observed'
           END
         ) AS turnover_status,
         COALESCE(
           latest.evidence_json ->> 'claim_rate_status',
           CASE
             WHEN latest.weekly_orders IS NULL THEN 'missing'
             WHEN latest.weekly_orders = 0 THEN 'no_effective_orders'
             WHEN latest.claim_rate IS NULL THEN 'missing'
             ELSE 'observed'
           END
         ) AS claim_rate_status
    FROM requested
    LEFT JOIN business.sku_master s ON s.sku = requested.sku
    LEFT JOIN middleware.mkd_customer_product mp ON mp.sku = requested.sku
    LEFT JOIN business.sku_type_dict d ON d.type_code = s.current_type_code
    LEFT JOIN latest_classification latest ON latest.sku = requested.sku
`;

export const LEGACY_OPERATING_FIELDS_SQL = `
  SELECT requested.sku,
         COALESCE(
           NULLIF(mp.chinese_name, ''),
           mp.title,
           s.product_name_zh,
           '(未命名 ' || s.sku || ')'
         ) AS product_name,
         NULLIF(mp.image_url, '') AS image_url,
         s.brand_name,
         s.primary_shop,
         s.current_type_code,
         d.name_zh AS type_name,
         d.display_color AS type_color,
         latest.iso_year AS metric_iso_year,
         latest.iso_week AS metric_iso_week,
         latest.weekly_gmv,
         margin.gross_margin_v2 AS profit_margin,
         turnover.inv_turnover_days_calc AS turnover_days,
         latest.claim_rate,
         CASE
           WHEN latest.gmv_source_status = 'partial' THEN 'source_partial'
           WHEN latest.gmv_source_status = 'missing' OR latest.weekly_gmv IS NULL THEN 'source_missing'
           ELSE 'observed'
         END AS weekly_gmv_status,
         CASE
           WHEN latest.gmv_source_status = 'partial' THEN 'source_partial'
           WHEN latest.gmv_source_status = 'missing' THEN 'source_missing'
           WHEN latest.weekly_gmv = 0 THEN 'no_sales'
           WHEN margin.gross_margin_v2 IS NULL THEN 'missing_profit'
           ELSE 'observed'
         END AS profit_margin_status,
         CASE
           WHEN turnover.inv_qty IS NULL THEN 'missing_inventory'
           WHEN turnover.inv_qty = 0 THEN 'no_inventory'
           WHEN latest.gmv_source_status = 'partial' THEN 'source_partial'
           WHEN latest.gmv_source_status = 'missing' THEN 'source_missing'
           WHEN turnover.inv_turnover_days_calc IS NULL THEN 'missing_inventory'
           ELSE 'observed'
         END AS turnover_status,
         CASE
           WHEN latest.weekly_orders IS NULL THEN 'missing'
           WHEN latest.weekly_orders = 0 THEN 'no_effective_orders'
           WHEN latest.claim_rate IS NULL THEN 'missing'
           ELSE 'observed'
         END AS claim_rate_status
    FROM unnest($1::text[]) AS requested(sku)
    LEFT JOIN business.sku_master s ON s.sku = requested.sku
    LEFT JOIN middleware.mkd_customer_product mp ON mp.sku = requested.sku
    LEFT JOIN business.sku_type_dict d ON d.type_code = s.current_type_code
    LEFT JOIN LATERAL (
      SELECT c.iso_year,
             c.iso_week,
             c.weekly_gmv,
             c.claim_rate,
             COALESCE(
               c.evidence_json ->> 'gmv_source_status',
               metrics.anomaly_flags ->> 'gmv_source_status'
             ) AS gmv_source_status,
             metrics.weekly_orders
        FROM business.sku_weekly_classification c
        LEFT JOIN business.sku_weekly_metrics metrics
          ON metrics.sku = c.sku
         AND metrics.iso_year = c.iso_year
         AND metrics.iso_week = c.iso_week
       WHERE c.sku = requested.sku
       ORDER BY c.iso_year DESC, c.iso_week DESC
       LIMIT 1
    ) latest ON true
    LEFT JOIN LATERAL (
      SELECT gross_margin_v2
        FROM business_ext.sku_weekly_derived_v2
       WHERE sku = requested.sku
         AND iso_year = latest.iso_year
         AND iso_week = latest.iso_week
       LIMIT 1
    ) margin ON true
    LEFT JOIN LATERAL (
      SELECT inv_qty, inv_turnover_days_calc
        FROM business_ext.sku_weekly_full_v
       WHERE sku = requested.sku
         AND iso_year = latest.iso_year
         AND iso_week = latest.iso_week
       LIMIT 1
    ) turnover ON true
`;

export async function loadReadModelFields(
  query: Query,
  skus: string[],
  contractVersion: string,
): Promise<Map<string, ReadModelOperatingFields>> {
  const result = new Map<string, ReadModelOperatingFields>();
  if (skus.length === 0) return result;

  const rows = await query<Record<string, unknown>>(READ_MODEL_FIELDS_SQL, [
    skus,
    contractVersion,
  ]);
  for (const row of rows) {
    const parsed = taskSkuOperatingFieldsSchema.parse(row);
    result.set(parsed.sku, {
      ...parsed,
      contract_version: String(row.contract_version),
      focus_batch_id: String(row.focus_batch_id),
    });
  }
  return result;
}

export async function loadBatchOperatingFields(
  query: Query,
  skus: string[],
): Promise<Map<string, TaskSkuOperatingFields>> {
  const result = new Map<string, TaskSkuOperatingFields>();
  if (skus.length === 0) return result;

  const rows = await query<Record<string, unknown>>(
    BATCH_OPERATING_FIELDS_SQL,
    [skus],
  );
  for (const row of rows) {
    const parsed = taskSkuOperatingFieldsSchema.parse(row);
    result.set(parsed.sku, parsed);
  }
  return result;
}

export async function loadEtlSnapshotOperatingFields(
  query: Query,
  skus: string[],
): Promise<Map<string, TaskSkuOperatingFields>> {
  const result = new Map<string, TaskSkuOperatingFields>();
  if (skus.length === 0) return result;

  const rows = await query<Record<string, unknown>>(
    ETL_SNAPSHOT_OPERATING_FIELDS_SQL,
    [skus],
  );
  for (const row of rows) {
    const parsed = taskSkuOperatingFieldsSchema.parse(row);
    result.set(parsed.sku, parsed);
  }
  return result;
}

export async function loadLegacyOperatingFields(
  query: Query,
  skus: string[],
): Promise<Map<string, TaskSkuOperatingFields>> {
  const result = new Map<string, TaskSkuOperatingFields>();
  if (skus.length === 0) return result;

  const rows = await query<Record<string, unknown>>(LEGACY_OPERATING_FIELDS_SQL, [skus]);
  for (const row of rows) {
    const parsed = taskSkuOperatingFieldsSchema.parse(row);
    result.set(parsed.sku, parsed);
  }
  return result;
}
