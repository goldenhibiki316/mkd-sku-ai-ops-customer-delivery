import {
  TASK_OPERATING_CONTRACT_VERSION,
  type TaskSkuOperatingFields,
} from "../../shared/taskOperating";
import {
  loadLegacyOperatingFields,
  loadReadModelFields,
  type Query,
} from "./operatingFieldsSource";
import { TaskReadModelRefreshingError } from "../httpErrors";
import { checkReadModelReadiness } from "./readModelReadiness";
import { buildTaskFilter, type TaskFilterInput } from "./taskFilters";

export type TaskPageInput = {
  page: number;
  pageSize: number;
  sort: string;
  readModelEnabled?: boolean;
};

export type TaskPageRow = {
  sku: string;
  [key: string]: unknown;
};

export type OperatingFieldRow = Partial<TaskSkuOperatingFields> & {
  sku: string;
  contract_version?: string;
};

export type TaskReadDependencies = {
  selectTaskPage: (input: TaskPageInput) => Promise<TaskPageRow[]>;
  countTasks: (input: TaskPageInput) => Promise<number>;
  isReadModelReady?: () => Promise<boolean>;
  loadReadModel: (skus: string[]) => Promise<Map<string, OperatingFieldRow>>;
  loadLegacyOperating: (skus: string[]) => Promise<Map<string, OperatingFieldRow>>;
  mapTask?: (task: TaskPageRow, fields: OperatingFieldRow | undefined) => TaskPageRow;
  onReadModelError?: (error: unknown) => void;
  onPhase?: (name: TaskReadPhase, durationMs: number) => void;
  now?: () => number;
};

export type TaskReadPhase =
  | "task_filter_ms"
  | "task_count_ms"
  | "operating_fields_ms"
  | "legacy_fallback_ms"
  | "mapping_ms";

type ReadOnlyRepeatableRead = <T>(
  work: (query: Query) => Promise<T>,
) => Promise<T>;

export async function loadTaskPageWithOptionalReadSnapshot(options: {
  input: TaskPageInput;
  defaultQuery: Query;
  createDependencies: (query: Query) => TaskReadDependencies;
  withReadOnlyRepeatableRead: ReadOnlyRepeatableRead;
}) {
  const execute = (query: Query) =>
    loadTaskPage(options.input, options.createDependencies(query));

  if (
    options.input.readModelEnabled !== false &&
    options.input.sort === "ai"
  ) {
    return options.withReadOnlyRepeatableRead(execute);
  }
  return execute(options.defaultQuery);
}

type TaskReadDependencyOptions = {
  query: Query;
  filter: TaskFilterInput;
  limit: number;
  offset: number;
  sort: string;
  readModelEnabled: boolean;
  translateReason: (value: unknown) => string | null;
  sanitizeText: (value: string) => string;
  onPhase?: (name: TaskReadPhase, durationMs: number) => void;
};

export function createTaskReadDependencies(
  options: TaskReadDependencyOptions,
): TaskReadDependencies {
  const filter = buildTaskFilter(options.filter);

  return {
    selectTaskPage: async (input) => {
      const params = filter.params.slice();
      const readModelEnabled = input.readModelEnabled ?? options.readModelEnabled;
      let contractPlaceholder = "";
      if (input.sort === "ai" && readModelEnabled) {
        params.push(TASK_OPERATING_CONTRACT_VERSION);
        contractPlaceholder = `$${params.length}`;
      }
      const sort = buildTaskSort(
        input.sort,
        readModelEnabled,
        contractPlaceholder,
      );
      params.push(options.limit);
      const limitPlaceholder = `$${params.length}`;
      params.push(options.offset);
      const offsetPlaceholder = `$${params.length}`;
      return options.query<TaskPageRow>(
        `SELECT t.id, t.sku, t.iso_year, t.iso_week, t.source, t.task_type,
                t.priority, t.title, t.detail,
                t.reason_summary AS reason_summary_raw,
                t.expected_impact, t.status, t.owner,
                t.due_date::text AS due_date,
                t.created_at::text AS created_at,
                NULLIF(mp.link, '') AS product_link,
                s.season_tag, s.lifecycle, s.unit_cost_clp
           FROM business.ops_task t
           LEFT JOIN business.sku_master s ON s.sku = t.sku
           LEFT JOIN middleware.mkd_customer_product mp ON mp.sku = t.sku
           ${sort.joins}
          WHERE ${filter.sql}
          ${sort.orderBy}
          LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
        params,
      );
    },
    countTasks: async () => {
      const rows = await options.query<{ c: number }>(
        `SELECT COUNT(*)::int AS c
           FROM business.ops_task t
           LEFT JOIN business.sku_master s ON s.sku = t.sku
           LEFT JOIN middleware.mkd_customer_product mp ON mp.sku = t.sku
          WHERE ${filter.sql}`,
        filter.params,
      );
      return rows[0]?.c ?? 0;
    },
    isReadModelReady: () => checkReadModelReadiness(
      options.query,
      filter,
      TASK_OPERATING_CONTRACT_VERSION,
    ),
    loadReadModel: (skus) => loadReadModelFields(
      options.query,
      skus,
      TASK_OPERATING_CONTRACT_VERSION,
    ),
    loadLegacyOperating: (skus) =>
      loadLegacyOperatingFields(options.query, skus),
    mapTask: (task, fields) => {
      const reasonSummary = options.translateReason(task.reason_summary_raw);
      const { reason_summary_raw: _rawReason, ...taskWithoutRawReason } = task;
      const status = normalizeTaskStatus(task.status);
      const title = typeof task.title === "string"
        ? options.sanitizeText(task.title)
        : task.title;
      const expectedImpact = typeof task.expected_impact === "string"
        ? options.sanitizeText(task.expected_impact)
        : task.expected_impact;
      const result = {
        ...taskWithoutRawReason,
        ...fields,
        title,
        expected_impact: expectedImpact,
        reason_summary: reasonSummary,
        status,
      };
      return result;
    },
    onReadModelError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[task-read-model] request issue: ${message}`);
    },
    onPhase: options.onPhase,
  };
}

async function measureTaskReadPhase<T>(
  deps: TaskReadDependencies,
  name: TaskReadPhase,
  work: () => Promise<T>,
): Promise<T> {
  const now = deps.now ?? (() => performance.now());
  const startedAt = now();
  try {
    return await work();
  } finally {
    deps.onPhase?.(name, Math.max(0, now() - startedAt));
  }
}

function measureTaskReadMapping<T>(
  deps: TaskReadDependencies,
  work: () => T,
): T {
  const now = deps.now ?? (() => performance.now());
  const startedAt = now();
  try {
    return work();
  } finally {
    deps.onPhase?.("mapping_ms", Math.max(0, now() - startedAt));
  }
}

function buildTaskSort(
  sort: string,
  readModelEnabled: boolean,
  contractPlaceholder: string,
): { joins: string; orderBy: string } {
  if (sort !== "ai") {
    return {
      joins: "",
      orderBy:
        "ORDER BY t.priority DESC NULLS LAST, t.created_at DESC, t.id ASC",
    };
  }

  const typeWeight = (typeExpression: string) => `CASE ${typeExpression}
    WHEN 'R_HIGH_CLAIM' THEN 100
    WHEN 'R_SLOW_LOW' THEN 90
    WHEN 'R_CLEARANCE' THEN 85
    WHEN 'R_INV_HIGH' THEN 80
    WHEN 'R_PROFIT_LOW' THEN 70
    WHEN 'R_MASS_LOW' THEN 65
    WHEN 'R_NEW_SLOW' THEN 60
    WHEN 'R_SLOW_MID' THEN 55
    WHEN 'R_PROFIT_MID' THEN 40
    WHEN 'R_NORMAL_NEW' THEN 30
    WHEN 'R_STAR' THEN 25
    ELSE 20
  END`;

  if (readModelEnabled) {
    return {
      joins: `LEFT JOIN business_ext.sku_operation_read_model sort_model
                ON sort_model.sku = t.sku
               AND sort_model.contract_version = ${contractPlaceholder}`,
      orderBy: `ORDER BY (
        (${typeWeight("COALESCE(sort_model.type_code, s.current_type_code)")})
        + LEAST(30, COALESCE(sort_model.weekly_gmv, 0) / 50000)
        + (CASE
            WHEN sort_model.profit_margin < 0 THEN 40
            WHEN sort_model.profit_margin < 0.1 THEN 20
            WHEN sort_model.profit_margin < 0.2 THEN 8
            ELSE 0
          END)
        + LEAST(30, COALESCE(sort_model.claim_rate, 0) * 500)
        + (COALESCE(t.priority, 1) * 10)
      ) DESC NULLS LAST, t.created_at DESC, t.id ASC`,
    };
  }

  return {
    joins: `LEFT JOIN LATERAL (
              SELECT c.iso_year, c.iso_week, c.weekly_gmv, c.claim_rate,
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
               WHERE c.sku = t.sku
               ORDER BY c.iso_year DESC, c.iso_week DESC
               LIMIT 1
            ) latest ON true
            LEFT JOIN LATERAL (
              SELECT gross_margin_v2
                FROM business_ext.sku_weekly_derived_v2
               WHERE sku = t.sku
                 AND iso_year = latest.iso_year
                 AND iso_week = latest.iso_week
               LIMIT 1
            ) margin ON true
            LEFT JOIN LATERAL (
              SELECT inv_qty, inv_turnover_days_calc
                FROM business_ext.sku_weekly_full_v
               WHERE sku = t.sku
                 AND iso_year = latest.iso_year
                 AND iso_week = latest.iso_week
               LIMIT 1
            ) turnover ON true`,
    orderBy: `ORDER BY (
      (${typeWeight("s.current_type_code")})
      + LEAST(30, COALESCE(latest.weekly_gmv, 0) / 50000)
      + (CASE
          WHEN margin.gross_margin_v2 < 0 THEN 40
          WHEN margin.gross_margin_v2 < 0.1 THEN 20
          WHEN margin.gross_margin_v2 < 0.2 THEN 8
          ELSE 0
        END)
      + LEAST(30, COALESCE(latest.claim_rate, 0) * 500)
      + (COALESCE(t.priority, 1) * 10)
    ) DESC NULLS LAST, t.created_at DESC, t.id ASC`,
  };
}

function normalizeTaskStatus(value: unknown): "open" | "in_progress" | "done" {
  const status = String(value ?? "").toLowerCase();
  if (["closed", "done", "dismissed"].includes(status)) return "done";
  if (["in_progress", "doing", "claimed"].includes(status)) return "in_progress";
  return "open";
}

export async function loadTaskPage(
  input: TaskPageInput,
  deps: TaskReadDependencies,
) {
  const useReadModel = input.readModelEnabled !== false;
  const aiReadModelSort = useReadModel && input.sort === "ai";
  if (aiReadModelSort) {
    let ready = false;
    try {
      ready = await deps.isReadModelReady?.() === true;
    } catch (error) {
      deps.onReadModelError?.(error);
    }
    if (!ready) throw new TaskReadModelRefreshingError();
  }
  const effectiveInput = { ...input, readModelEnabled: useReadModel };
  let taskRows: TaskPageRow[];
  let total: number;
  if (aiReadModelSort) {
    taskRows = await measureTaskReadPhase(
      deps,
      "task_filter_ms",
      () => deps.selectTaskPage(effectiveInput),
    );
    total = await measureTaskReadPhase(
      deps,
      "task_count_ms",
      () => deps.countTasks(effectiveInput),
    );
  } else {
    [taskRows, total] = await Promise.all([
      measureTaskReadPhase(
        deps,
        "task_filter_ms",
        () => deps.selectTaskPage(effectiveInput),
      ),
      measureTaskReadPhase(
        deps,
        "task_count_ms",
        () => deps.countTasks(effectiveInput),
      ),
    ]);
  }
  const skus = Array.from(new Set(taskRows.map((row) => row.sku)));
  const readModel = await measureTaskReadPhase(
    deps,
    "operating_fields_ms",
    async () => {
      if (!useReadModel) return new Map<string, OperatingFieldRow>();
      try {
        return await deps.loadReadModel(skus);
      } catch (error) {
        deps.onReadModelError?.(error);
        if (aiReadModelSort) throw new TaskReadModelRefreshingError();
        return new Map<string, OperatingFieldRow>();
      }
    }
  );
  const fallbackSkus = useReadModel
    ? skus.filter(
        (sku) =>
          readModel.get(sku)?.contract_version !== TASK_OPERATING_CONTRACT_VERSION,
      )
    : skus;
  if (aiReadModelSort && fallbackSkus.length > 0) {
    throw new TaskReadModelRefreshingError();
  }
  const legacy = await measureTaskReadPhase(
    deps,
    "legacy_fallback_ms",
    () => deps.loadLegacyOperating(fallbackSkus),
  );
  const fields = new Map<string, OperatingFieldRow>();
  readModel.forEach((value, sku) => fields.set(sku, value));
  legacy.forEach((value, sku) => fields.set(sku, value));
  const mapTask: NonNullable<TaskReadDependencies["mapTask"]> =
    deps.mapTask ?? ((task, operating) => ({ ...task, ...operating }));
  const tasks = measureTaskReadMapping(deps, () => {
    const mappedTasks: TaskPageRow[] = taskRows.map((task) =>
      mapTask(task, fields.get(task.sku))
    );

    if (input.sort === "ai") {
      for (let index = 0; index < mappedTasks.length; index += 1) {
        const task = mappedTasks[index];
        const reasons: string[] = [];
        const profitMargin = asOptionalNumber(task.profit_margin);
        const claimRate = asOptionalNumber(task.claim_rate);
        const weeklyGmv = asOptionalNumber(task.weekly_gmv);
        if (profitMargin !== null && profitMargin < 0) reasons.push("毛利为负");
        else if (profitMargin !== null && profitMargin < 0.1) reasons.push("毛利偏低");
        if (claimRate !== null && claimRate > 0.03) reasons.push("索赔率偏高");
        if (weeklyGmv !== null && weeklyGmv > 500_000) reasons.push("GMV 规模大");
        if (task.type_name) reasons.push(String(task.type_name));
        task.ai_score = mappedTasks.length - index;
        task.ai_reason = reasons.length > 0
          ? reasons.slice(0, 3).join(" · ")
          : "综合优先处理";
      }
    }
    return mappedTasks;
  });

  return {
    tasks,
    total,
    page: input.page,
    page_size: input.pageSize,
    read_model: {
      enabled: useReadModel,
      fallback_sku_count: fallbackSkus.length,
      contract_version: TASK_OPERATING_CONTRACT_VERSION,
    },
  };
}

function asOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
