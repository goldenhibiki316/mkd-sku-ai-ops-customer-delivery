import type { Query } from "./operatingFieldsSource";
import { pageMeta } from "./pagination";

export type TypeOperatingFieldRow = {
  sku: string;
  contract_version?: string;
};

export type TypeOperatingFieldsDependencies = {
  readModelEnabled: boolean;
  contractVersion: string;
  loadReadModel: (
    skus: string[],
  ) => Promise<Map<string, TypeOperatingFieldRow>>;
  loadLegacy: (
    skus: string[],
  ) => Promise<Map<string, TypeOperatingFieldRow>>;
  onReadModelError?: (error: unknown) => void;
};

export async function loadTypeOperatingFields(
  dependencies: TypeOperatingFieldsDependencies,
  skus: string[],
): Promise<TypeOperatingFieldRow[]> {
  let readModel = new Map<string, TypeOperatingFieldRow>();
  if (dependencies.readModelEnabled) {
    try {
      readModel = await dependencies.loadReadModel(skus);
    } catch (error) {
      dependencies.onReadModelError?.(error);
    }
  }

  const fallbackSkus = dependencies.readModelEnabled
    ? skus.filter(
        (sku) =>
          readModel.get(sku)?.contract_version !== dependencies.contractVersion,
      )
    : skus;
  const legacy = await dependencies.loadLegacy(fallbackSkus);

  return skus.flatMap((sku) => {
    const row = legacy.get(sku) ?? readModel.get(sku);
    return row ? [row] : [];
  });
}

export type TypeSkuPageDependencies<Row extends { sku: string }> = {
  countTypeSkus: (typeCode: string) => Promise<number>;
  selectTypePageKeys: (
    typeCode: string,
    pageSize: number,
    offset: number,
  ) => Promise<string[]>;
  loadOperatingFields: (skus: string[]) => Promise<Row[]>;
};

export function createTypeSkuPageDependencies<Row extends { sku: string }>(
  query: Query,
  loadOperatingFields: (skus: string[]) => Promise<Row[]>,
): TypeSkuPageDependencies<Row> {
  return {
    countTypeSkus: async (typeCode) => {
      const rows = await query<{ total: number }>(
        `SELECT count(*)::int AS total
           FROM business.sku_master
          WHERE current_type_code = $1`,
        [typeCode],
      );
      return Number(rows[0]?.total ?? 0);
    },
    selectTypePageKeys: async (typeCode, pageSize, offset) => {
      const rows = await query<{ sku: string }>(
        `WITH type_skus AS MATERIALIZED (
           SELECT sku
             FROM business.sku_master
            WHERE current_type_code = $1
         ), latest AS MATERIALIZED (
           SELECT DISTINCT ON (c.sku)
                  c.sku,
                  c.weekly_gmv
             FROM business.sku_weekly_classification c
             JOIN type_skus s ON s.sku = c.sku
            ORDER BY c.sku, c.iso_year DESC, c.iso_week DESC
         )
         SELECT s.sku
           FROM type_skus s
           LEFT JOIN latest ON latest.sku = s.sku
          ORDER BY latest.weekly_gmv DESC NULLS LAST, s.sku ASC
          LIMIT $2 OFFSET $3`,
        [typeCode, pageSize, offset],
      );
      return rows.map((row) => row.sku);
    },
    loadOperatingFields,
  };
}

export async function loadTypeSkuPage<Row extends { sku: string }>(
  dependencies: TypeSkuPageDependencies<Row>,
  typeCode: string,
  page: number,
  pageSize: number,
) {
  const offset = (page - 1) * pageSize;
  const total = await dependencies.countTypeSkus(typeCode);
  const meta = pageMeta(total, page, pageSize);
  const skus = await dependencies.selectTypePageKeys(
    typeCode,
    pageSize,
    offset,
  );
  const fields = await dependencies.loadOperatingFields(skus);
  return {
    skus: fields,
    ...meta,
  };
}

export type TransitionRange = {
  startYear: number | null;
  startWeek: number | null;
  endYear: number | null;
  endWeek: number | null;
  kind: string | null;
};

export type TransitionGroupCounts = {
  totalSkus: number;
  totalRecords: number;
};

export type TransitionRow = {
  sku: string;
  [key: string]: unknown;
};

export type TransitionListDependencies<Row extends TransitionRow = TransitionRow> = {
  countTransitionGroups: (
    range: TransitionRange,
  ) => Promise<TransitionGroupCounts>;
  selectTransitionGroups: (
    range: TransitionRange,
    pageSize: number,
    offset: number,
  ) => Promise<Row[]>;
  selectTransitionHistory: (
    sku: string,
    range: TransitionRange,
  ) => Promise<Row[]>;
};

export function parseTransitionRange(
  query: Record<string, unknown>,
): TransitionRange {
  return {
    startYear: query.start_year ? Number(query.start_year) : null,
    startWeek: query.start_week ? Number(query.start_week) : null,
    endYear: query.end_year ? Number(query.end_year) : null,
    endWeek: query.end_week ? Number(query.end_week) : null,
    kind: query.kind ? String(query.kind) : null,
  };
}

export function buildTransitionRangeWhere(range: TransitionRange): {
  where: string;
  params: unknown[];
} {
  const params: unknown[] = [];
  let where = "1=1";

  if (range.startYear && range.startWeek) {
    params.push(range.startYear * 100 + range.startWeek);
    where += ` AND (t.to_iso_year * 100 + t.to_iso_week) >= $${params.length}`;
  }
  if (range.endYear && range.endWeek) {
    params.push(range.endYear * 100 + range.endWeek);
    where += ` AND (t.to_iso_year * 100 + t.to_iso_week) <= $${params.length}`;
  }
  if (range.kind) {
    params.push(range.kind);
    where += ` AND t.transition_kind = $${params.length}`;
  }

  return { where, params };
}

export function createTransitionListDependencies<
  Row extends TransitionRow = TransitionRow,
>(query: Query): TransitionListDependencies<Row> {
  return {
    countTransitionGroups: async (range) => {
      const { where, params } = buildTransitionRangeWhere(range);
      const rows = await query<{
        total_skus: number;
        total_records: number;
      }>(
        `WITH filtered AS (
           SELECT t.sku
             FROM business.sku_classification_transition t
            WHERE ${where}
         )
         SELECT count(DISTINCT sku)::int AS total_skus,
                count(*)::int AS total_records
           FROM filtered`,
        params,
      );
      return {
        totalSkus: Number(rows[0]?.total_skus ?? 0),
        totalRecords: Number(rows[0]?.total_records ?? 0),
      };
    },
    selectTransitionGroups: async (range, pageSize, offset) => {
      const { where, params } = buildTransitionRangeWhere(range);
      const pageSizeParam = `$${params.length + 1}`;
      const offsetParam = `$${params.length + 2}`;
      return query<Row>(
        `WITH filtered AS (
           SELECT t.*
             FROM business.sku_classification_transition t
            WHERE ${where}
         ), page_skus AS (
           SELECT sku,
                  max(detected_at) AS latest_detected_at,
                  count(*)::int AS record_count
             FROM filtered
            GROUP BY sku
            ORDER BY latest_detected_at DESC, sku ASC
            LIMIT ${pageSizeParam} OFFSET ${offsetParam}
         ), latest_row AS (
           SELECT DISTINCT ON (f.sku) f.*
             FROM filtered f
             JOIN page_skus p ON p.sku = f.sku
            ORDER BY f.sku,
                     f.detected_at DESC,
                     f.to_iso_year DESC,
                     f.to_iso_week DESC,
                     f.from_iso_year DESC,
                     f.from_iso_week DESC,
                     f.transition_kind ASC NULLS LAST,
                     f.from_type_code ASC,
                     f.to_type_code ASC,
                     f.primary_reason ASC NULLS LAST
         )
         SELECT latest_row.sku,
                latest_row.from_iso_year,
                latest_row.from_iso_week,
                latest_row.from_type_code,
                latest_row.to_iso_year,
                latest_row.to_iso_week,
                latest_row.to_type_code,
                latest_row.transition_kind,
                latest_row.primary_reason AS primary_reason_raw,
                latest_row.detected_at::text AS detected_at,
                page_skus.latest_detected_at::text AS latest_detected_at,
                page_skus.record_count,
                COALESCE(
                  NULLIF(mp.chinese_name, ''),
                  mp.title,
                  '(未命名 ' || latest_row.sku || ')'
                ) AS product_name,
                NULLIF(mp.image_url, '') AS image_url,
                s.primary_shop,
                df.name_zh AS from_name,
                df.display_color AS from_color,
                dt.name_zh AS to_name,
                dt.display_color AS to_color
           FROM latest_row
           JOIN page_skus ON page_skus.sku = latest_row.sku
           LEFT JOIN business.sku_master s ON s.sku = latest_row.sku
           LEFT JOIN middleware.mkd_customer_product mp
             ON mp.sku = latest_row.sku
           LEFT JOIN business.sku_type_dict df
             ON df.type_code = latest_row.from_type_code
           LEFT JOIN business.sku_type_dict dt
             ON dt.type_code = latest_row.to_type_code
          ORDER BY page_skus.latest_detected_at DESC, latest_row.sku ASC`,
        [...params, pageSize, offset],
      );
    },
    selectTransitionHistory: async (sku, range) => {
      const { where, params } = buildTransitionRangeWhere(range);
      const skuParam = `$${params.length + 1}`;
      return query<Row>(
        `SELECT t.sku,
                t.from_iso_year,
                t.from_iso_week,
                t.from_type_code,
                t.to_iso_year,
                t.to_iso_week,
                t.to_type_code,
                t.transition_kind,
                t.primary_reason AS primary_reason_raw,
                t.detected_at::text AS detected_at,
                COALESCE(
                  NULLIF(mp.chinese_name, ''),
                  mp.title,
                  '(未命名 ' || t.sku || ')'
                ) AS product_name,
                NULLIF(mp.image_url, '') AS image_url,
                s.primary_shop,
                df.name_zh AS from_name,
                df.display_color AS from_color,
                dt.name_zh AS to_name,
                dt.display_color AS to_color
           FROM business.sku_classification_transition t
           LEFT JOIN business.sku_master s ON s.sku = t.sku
           LEFT JOIN middleware.mkd_customer_product mp ON mp.sku = t.sku
           LEFT JOIN business.sku_type_dict df
             ON df.type_code = t.from_type_code
           LEFT JOIN business.sku_type_dict dt
             ON dt.type_code = t.to_type_code
          WHERE ${where}
            AND t.sku = ${skuParam}
          ORDER BY t.detected_at DESC,
                   t.to_iso_year DESC,
                   t.to_iso_week DESC,
                   t.from_iso_year DESC,
                   t.from_iso_week DESC,
                   t.transition_kind ASC NULLS LAST,
                   t.from_type_code ASC,
                   t.to_type_code ASC,
                   t.primary_reason ASC NULLS LAST`,
        [...params, sku],
      );
    },
  };
}

export async function loadTransitionGroupPage<Row extends TransitionRow>(
  dependencies: TransitionListDependencies<Row>,
  range: TransitionRange,
  page: number,
  pageSize: number,
) {
  const counts = await dependencies.countTransitionGroups(range);
  const meta = pageMeta(counts.totalSkus, page, pageSize);
  const groups = await dependencies.selectTransitionGroups(
    range,
    pageSize,
    (page - 1) * pageSize,
  );
  return {
    groups,
    total_skus: counts.totalSkus,
    total_records: counts.totalRecords,
    page: meta.page,
    page_size: meta.page_size,
    last_page: meta.last_page,
    range_start: meta.range_start,
    range_end: meta.range_end,
  };
}

export async function loadTransitionHistory<Row extends TransitionRow>(
  dependencies: TransitionListDependencies<Row>,
  sku: string,
  range: TransitionRange,
): Promise<Row[]> {
  return dependencies.selectTransitionHistory(sku, range);
}
