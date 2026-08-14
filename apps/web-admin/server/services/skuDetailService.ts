import { AppHttpError } from "../httpErrors";
import type { TaskSkuOperatingFields } from "../../shared/taskOperating";
import type {
  Query,
  ReadModelOperatingFields,
} from "./operatingFieldsSource";

export type SkuSummaryDependencies = {
  readModelEnabled: boolean;
  contractVersion: string;
  loadReadModel: (
    skus: string[],
  ) => Promise<Map<string, ReadModelOperatingFields>>;
  loadBatch: (
    skus: string[],
  ) => Promise<Map<string, TaskSkuOperatingFields>>;
  onReadModelError?: (error: unknown) => void;
};

const SKU_IDENTITY_SQL = `
  SELECT s.*,
         COALESCE(NULLIF(mp.chinese_name,''), mp.title, s.product_name_zh, '(未命名 ' || s.sku || ')') AS product_name,
         NULLIF(mp.image_url,'') AS image_url,
         NULLIF(mp.link,'') AS product_link,
         s.brand_name,
         s.primary_shop,
         s.current_type_code,
         s.season_tag,
         s.lifecycle,
         s.unit_cost_clp
    FROM business.sku_master s
    LEFT JOIN middleware.mkd_customer_product mp ON mp.sku = s.sku
   WHERE s.sku = $1`;

const LATEST_CLASSIFICATION_SQL = `
  SELECT iso_year, iso_week, evidence_json
    FROM business.sku_weekly_classification
   WHERE sku = $1
   ORDER BY iso_year DESC, iso_week DESC
   LIMIT 1`;

const WEEKLY_HISTORY_SQL = `
  SELECT classification.iso_year,
         classification.iso_week,
         classification.type_code,
         metrics.weekly_gmv,
         margin.gross_margin_v2 AS profit_margin,
         turnover.inv_turnover_days_calc AS turnover_days,
         metrics.claim_rate
    FROM business.sku_weekly_classification classification
    LEFT JOIN business.sku_weekly_metrics metrics
      ON metrics.sku = classification.sku
     AND metrics.iso_year = classification.iso_year
     AND metrics.iso_week = classification.iso_week
    LEFT JOIN business_ext.sku_weekly_derived_v2 margin
      ON margin.sku = classification.sku
     AND margin.iso_year = classification.iso_year
     AND margin.iso_week = classification.iso_week
    LEFT JOIN business_ext.sku_weekly_full_v turnover
      ON turnover.sku = classification.sku
     AND turnover.iso_year = classification.iso_year
     AND turnover.iso_week = classification.iso_week
   WHERE classification.sku = $1
   ORDER BY classification.iso_year DESC, classification.iso_week DESC
   LIMIT 12`;

const SKU_TASKS_SQL = `
  SELECT id, task_type, priority, title, detail, reason_summary, status, owner,
         due_date::text AS due_date, created_at::text AS created_at
    FROM business.ops_task
   WHERE sku = $1
   ORDER BY created_at DESC
   LIMIT 20`;

const SKU_TRANSITIONS_SQL = `
  SELECT from_iso_year, from_iso_week, from_type_code,
         to_iso_year, to_iso_week, to_type_code,
         transition_kind, primary_reason,
         detected_at::text AS detected_at
    FROM business.sku_classification_transition
   WHERE sku = $1
   ORDER BY detected_at DESC
   LIMIT 20`;

const BUYBOX_LISTINGS_SQL = `
  SELECT sku, meli_id, snapshot_at::text AS snapshot_at,
         our_price, our_price_from_ops, our_price_source, our_price_note,
         current_price, winner_price, price_to_win,
         current_price_source, winner_price_source,
         price_to_win_source, winner_gap_amount, winner_gap_rate,
         buybox_lost_flag, our_winner_flag, competitor_count,
         buybox_shipping_cost, abnormal_flag, under_review_flag
    FROM business_ext.sku_buybox_status_v
   WHERE sku = $1
   ORDER BY (winner_price IS NOT NULL) DESC, snapshot_at DESC
   LIMIT 5`;

type DetailTextMappers = {
  translateReason?: (value: string | null | undefined) => string | null;
  sanitizeText?: (value: string) => string;
};

function mapSummaryWeekly(
  fields: TaskSkuOperatingFields | null,
  classification: Record<string, unknown> | undefined,
) {
  if (!fields) return null;
  const matchingEvidenceJson = classification &&
      Number(classification.iso_year) === fields.metric_iso_year &&
      Number(classification.iso_week) === fields.metric_iso_week
    ? classification.evidence_json ?? null
    : null;
  return {
    iso_year: fields.metric_iso_year,
    iso_week: fields.metric_iso_week,
    weekly_gmv: fields.weekly_gmv,
    weekly_gmv_status: fields.weekly_gmv_status,
    profit_margin: fields.profit_margin,
    profit_margin_status: fields.profit_margin_status,
    turnover_days: fields.turnover_days,
    turnover_status: fields.turnover_status,
    claim_rate: fields.claim_rate,
    claim_rate_status: fields.claim_rate_status,
    evidence_json: matchingEvidenceJson,
  };
}

export async function loadSkuSummary(
  query: Query,
  sku: string,
  dependencies: SkuSummaryDependencies,
) {
  const [masterRows, classificationRows] = await Promise.all([
    query<Record<string, unknown>>(SKU_IDENTITY_SQL, [sku]),
    query<Record<string, unknown>>(LATEST_CLASSIFICATION_SQL, [sku]),
  ]);
  if (!masterRows[0]) {
    throw new AppHttpError(404, "SKU_NOT_FOUND", "SKU 不存在", false);
  }

  let fields: TaskSkuOperatingFields | null = null;
  if (dependencies.readModelEnabled) {
    try {
      const current = (await dependencies.loadReadModel([sku])).get(sku);
      if (current?.contract_version === dependencies.contractVersion) {
        fields = current;
      }
    } catch (error) {
      dependencies.onReadModelError?.(error);
    }
  }
  if (!fields) {
    fields = (await dependencies.loadBatch([sku])).get(sku) ?? null;
  }

  return {
    master: masterRows[0],
    latest_weekly: mapSummaryWeekly(fields, classificationRows[0]),
  };
}

export async function loadSkuWeeklyHistory(query: Query, sku: string) {
  return query<Record<string, unknown>>(WEEKLY_HISTORY_SQL, [sku]);
}

export async function loadSkuBuybox(
  query: Query,
  sku: string,
  page: number,
  pageSize: number,
) {
  const offset = (page - 1) * pageSize;
  const [listings, countRows, competitors] = await Promise.all([
    query<Record<string, unknown>>(BUYBOX_LISTINGS_SQL, [sku]),
    query<{ total: number }>(
      `SELECT count(*)::int AS total
         FROM business_ext.sku_competitor_list_v
        WHERE sku = $1`,
      [sku],
    ),
    query<Record<string, unknown>>(
      `SELECT competitor_meli_id, is_favorite, mapping_priority, mapping_source,
              title_similarity_score, image_similarity_score,
              competitor_title, competitor_price, competitor_base_price,
              competitor_sales_amount, competitor_stock,
              competitor_pred_rev_7d, review_rating, review_count,
              competitor_status, shipping_logistic_type, competitor_link,
              competitor_image, competitor_is_new,
              competitor_updated_at::text AS competitor_updated_at
         FROM business_ext.sku_competitor_list_v
        WHERE sku = $1
        ORDER BY is_favorite DESC NULLS LAST,
                 mapping_priority ASC NULLS LAST,
                 competitor_sales_amount DESC NULLS LAST,
                 competitor_meli_id ASC
        LIMIT $2 OFFSET $3`,
      [sku, pageSize, offset],
    ),
  ]);
  return {
    listings,
    competitors,
    competitor_total: Number(countRows[0]?.total ?? 0),
  };
}

export async function loadSkuTasks(
  query: Query,
  sku: string,
  mappers: DetailTextMappers = {},
) {
  const rows = await query<Record<string, unknown>>(SKU_TASKS_SQL, [sku]);
  return {
    tasks: rows.map((row) => {
      const displayTitle = typeof row.title === "string" && row.title.trim()
        ? row.title
        : row.task_type;
      return {
        ...row,
        reason_summary: mappers.translateReason
          ? mappers.translateReason(
            row.reason_summary as string | null | undefined,
          )
          : row.reason_summary,
        title: mappers.sanitizeText && typeof displayTitle === "string"
          ? mappers.sanitizeText(displayTitle)
          : row.title,
        detail: mappers.sanitizeText && typeof row.detail === "string"
          ? mappers.sanitizeText(row.detail)
          : row.detail,
      };
    }),
  };
}

export async function loadSkuTransitions(
  query: Query,
  sku: string,
  mappers: DetailTextMappers = {},
) {
  const rows = await query<Record<string, unknown>>(SKU_TRANSITIONS_SQL, [sku]);
  return {
    transitions: rows.map((row) => ({
      ...row,
      primary_reason: mappers.translateReason
        ? mappers.translateReason(
          row.primary_reason as string | null | undefined,
        )
        : row.primary_reason,
    })),
  };
}
