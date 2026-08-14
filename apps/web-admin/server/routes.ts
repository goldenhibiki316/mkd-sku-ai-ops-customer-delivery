import type { Express } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import {
  q,
  qRead,
  withReadOnlyRepeatableRead,
} from "./db";
import { anchorIsoWeek, anchorIsoWeekLimit } from "./anchor";
import {
  createTaskReadDependencies,
  loadTaskPageWithOptionalReadSnapshot,
} from "./services/taskReadService";
import type { SessionUser } from "./services/taskFilters";
import {
  resolveTaskReadModelEnabled,
  TASK_OPERATING_CONTRACT_VERSION,
} from "../shared/taskOperating";
import { handleTaskRouteError } from "./httpErrors";
import {
  buildAiAnalysisResponse,
  buildAiHistoryResponse,
  normalizeStoredAnalysisRecord,
  toLegacyAiDetail,
} from "./services/ai3a/analysisService";
import { Ai3aRepository } from "./services/ai3a/repository";
import { requireAuth } from "./auth";
import { pageMeta, parsePagination } from "./services/pagination";
import {
  loadSkuBuybox,
  loadSkuSummary,
  loadSkuTasks,
  loadSkuTransitions,
  loadSkuWeeklyHistory,
} from "./services/skuDetailService";
import { sanitizeTaskText } from "./services/taskTextSanitizer";
import {
  buildTransitionRangeWhere,
  createTransitionListDependencies,
  createTypeSkuPageDependencies,
  loadTransitionGroupPage,
  loadTransitionHistory,
  loadTypeOperatingFields,
  loadTypeSkuPage,
  parseTransitionRange,
} from "./services/paginatedListsService";
import {
  loadEtlSnapshotOperatingFields,
  loadReadModelFields,
} from "./services/operatingFieldsSource";
import { recordPhase } from "./requestContext";
import {
  CoreProtocolError,
  CoreUnavailableError,
  createCoreClientFromEnv,
} from "./coreClient";
import { getBuildVersion } from "./version";

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] ?? "" : value;
}

// ---- 商品信息 subquery (统一从 middleware.mkd_customer_product 读) ----
// s = business.sku_master (只读)
// mp = middleware.mkd_customer_product (只读)
const productFieldsSelect = `
  COALESCE(NULLIF(mp.chinese_name,''), mp.title, s.product_name_zh, '(未命名 ' || s.sku || ')') AS product_name,
  NULLIF(mp.image_url,'') AS image_url,
  NULLIF(mp.link,'') AS product_link,
  s.brand_name,
  s.primary_shop,
  s.current_type_code,
  s.season_tag,
  s.lifecycle,
  s.unit_cost_clp
`;

// 类型代码 -> 中文名(用于任务原因翻译)
const TYPE_ZH: Record<string, string> = {
  R_STAR: "明星品",
  R_PROFIT_MID: "利润品(中动销)",
  R_PROFIT_LOW: "利润品(低动销)",
  R_SLOW_LOW: "滞销品(低动销)",
  R_SLOW_MID: "滞销品(中动销)",
  R_BULK_LOW: "量产品(低利)",
  R_BULK_THIN: "量产品(微利)",
  R_HIGH_INV: "高库存品",
  R_HIGH_CLAIM: "高赔付品",
  R_CLEAR: "清货品",
  R_NEW_NORMAL: "正常新品",
  R_NEW_LOW: "低动销新品",
  S_NEW: "季节新品",
  S_PEAK: "旺季节品",
  S_TAIL: "末季节品",
  S_OFF: "过季积压品",
  S_SUSPEND: "季节暂停",
  S_DEAD: "过季死货",
};

function sanitizeText(raw: string | null | undefined): string {
  return sanitizeTaskText(raw, TYPE_ZH);
}

function translateReason(raw: string | null | undefined): string {
  if (!raw) return "本周分类刷新触发";
  // 先尝试匹配原始格式(代码 + confidence)
  const m0 = String(raw).match(/异常分类标记\s*\(([A-Z_]+),\s*confidence=([0-9.]+)\)/);
  if (m0) {
    const code = m0[1];
    const conf = Math.round(Number(m0[2]) * 100);
    return `被判定为 ${TYPE_ZH[code] || code}(置信度 ${conf}%)`;
  }
  // 匹配已翻译版:异常分类标记 (滞销品(低动销), confidence=0.850)
  const m1 = String(raw).match(/异常分类标记\s*\((.+?),\s*confidence=([0-9.]+)\)/);
  if (m1) {
    const zh = m1[1].trim();
    const conf = Math.round(Number(m1[2]) * 100);
    return `被判定为 ${zh}(置信度 ${conf}%)`;
  }
  // 兜底:sanitize 后返回
  return sanitizeText(String(raw));
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  const aiRepository = new Ai3aRepository({
    query: (sql, params = []) => q(sql, params as any[]),
  });
  const coreClient = createCoreClientFromEnv();
  const transitionListDependencies = createTransitionListDependencies(
    async <T = unknown>(
      sql: string,
      params: unknown[] = [],
    ): Promise<T[]> => qRead<T>(sql, params),
  );
  const loadSummary = (sku: string) => loadSkuSummary(qRead, sku, {
    readModelEnabled: resolveTaskReadModelEnabled(),
    contractVersion: TASK_OPERATING_CONTRACT_VERSION,
    loadReadModel: (requestedSkus) => loadReadModelFields(
      qRead,
      requestedSkus,
      TASK_OPERATING_CONTRACT_VERSION,
    ),
    loadBatch: (requestedSkus) =>
      loadEtlSnapshotOperatingFields(qRead, requestedSkus),
    onReadModelError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[sku-summary-read-model] request issue: ${message}`);
    },
  });

  // ---------- 健康检查 ----------
  app.get("/api/health", async (_req, res, next) => {
    try {
      const rows = await qRead<{ now: string }>("SELECT now()::text as now");
      res.json({ ok: true, db_time: rows[0].now });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/version", (_req, res) => {
    res.json(getBuildVersion());
  });

  // ---------- 概览 KPI(合并到工作台) ----------
  app.get("/api/overview", async (_req, res, next) => {
    try {
      const [master, weekly, tasks, transitions] = await Promise.all([
        qRead<{ total: number }>(`SELECT count(*)::int as total FROM business.sku_master`),
        qRead<{ total: number; year: number; week: number }>(
          `SELECT count(*)::int as total, iso_year as year, iso_week as week
             FROM business.sku_weekly_classification
             WHERE 1=1
             GROUP BY iso_year, iso_week
             ORDER BY iso_year DESC, iso_week DESC LIMIT 1`,
        ),
        qRead<{ pending: number; done: number; claimed: number }>(`
          SELECT
            count(*) FILTER (WHERE lower(status) IN ('open','pending'))::int as pending,
            count(*) FILTER (WHERE lower(status) IN ('claimed','doing','in_progress'))::int as claimed,
            count(*) FILTER (WHERE lower(status) IN ('done','closed'))::int as done
          FROM business.ops_task
        `),
        qRead<{ total: number }>(`SELECT count(*)::int as total FROM business.sku_classification_transition`),
      ]);
      res.json({
        total_sku: master[0]?.total ?? 0,
        latest_week: weekly[0] ? `${weekly[0].year}-W${String(weekly[0].week).padStart(2, "0")}` : null,
        latest_week_iso_year: weekly[0]?.year ?? null,
        latest_week_iso_week: weekly[0]?.week ?? null,
        latest_week_classified: weekly[0]?.total ?? 0,
        task_pending: tasks[0]?.pending ?? 0,
        task_claimed: tasks[0]?.claimed ?? 0,
        task_done: tasks[0]?.done ?? 0,
        total_transitions: transitions[0]?.total ?? 0,
      });
    } catch (error) {
      next(error);
    }
  });

  // ---------- ① 运营工作台:任务列表(含商品名/图) ----------
  app.get("/api/tasks", async (req, res, next) => {
    try {
      const status = String(req.query.status || "OPEN");
      const priority = req.query.priority ? Number(req.query.priority) : null;
      const owner = req.query.owner ? String(req.query.owner) : null;
      const search = String(req.query.search || "").trim();
      const hasPage =
        req.query.page !== undefined || req.query.page_size !== undefined;
      const page = Math.max(1, Number(req.query.page || 1));
      const pageSize = Math.min(
        100,
        Math.max(1, Number(req.query.page_size || 20)),
      );
      const limit = hasPage
        ? pageSize
        : Math.min(Number(req.query.limit || 100), 500);
      const offset = hasPage ? (page - 1) * pageSize : 0;
      const ownerFilter = String(req.query.owner_filter || "").toLowerCase();
      const taskType = req.query.task_type
        ? String(req.query.task_type)
        : null;
      const sortMode = String(req.query.sort || "default");
      const rawSessionUser = (req as any).session?.user as
        | { username?: unknown; role?: unknown }
        | undefined;
      const sessionUser: SessionUser | undefined =
        rawSessionUser &&
        (rawSessionUser.role === "admin" || rawSessionUser.role === "operator")
          ? {
              username: String(rawSessionUser.username || ""),
              role: rawSessionUser.role as SessionUser["role"],
            }
          : undefined;
      const readModelEnabled = resolveTaskReadModelEnabled();
      const query = async <T = unknown>(
        sql: string,
        params: unknown[] = [],
      ): Promise<T[]> => qRead<T>(sql, params);
      const input = {
        page: hasPage ? page : 1,
        pageSize: limit,
        sort: sortMode,
        readModelEnabled,
      };
      const result = await loadTaskPageWithOptionalReadSnapshot({
        input,
        defaultQuery: query,
        createDependencies: (scopedQuery) => createTaskReadDependencies({
          query: scopedQuery,
          filter: {
            status,
            priority,
            owner,
            ownerFilter,
            taskType,
            search,
            user: sessionUser,
          },
          limit,
          offset,
          sort: sortMode,
          readModelEnabled,
          translateReason: (value) =>
            translateReason(value === null || value === undefined
              ? null
              : String(value)),
          sanitizeText,
          onPhase: (name, durationMs) =>
            recordPhase(req, name, durationMs),
        }),
        withReadOnlyRepeatableRead,
      });

      const paginationMeta = hasPage
        ? pageMeta(result.total, page, pageSize)
        : { page: 1, page_size: result.tasks.length };
      res.json({
        ...result,
        ...paginationMeta,
      });
    } catch (e: any) {
      handleTaskRouteError(e, res, next);
    }
  });

  app.get("/api/tasks/stats", async (req, res, next) => {
    try {
      // 支持 status/priority 过滤下的 task_type 计数(用于二级 Tab 显示每类条数)
      const statusIn = String(req.query.status || "").toLowerCase();
      let statusDbVals: string[] | null = null;
      if (statusIn && statusIn !== "all") {
        if (statusIn === "open" || statusIn === "pending") statusDbVals = ["open", "pending"];
        else if (statusIn === "in_progress" || statusIn === "claimed" || statusIn === "doing") statusDbVals = ["in_progress", "doing", "claimed"];
        else if (statusIn === "done" || statusIn === "closed") statusDbVals = ["closed", "done", "dismissed"];
      }
      const priority = req.query.priority ? Number(req.query.priority) : null;

      const conds: string[] = ["1=1"];
      const params: any[] = [];
      if (statusDbVals) { params.push(statusDbVals); conds.push(`lower(status) = ANY($${params.length}::text[])`); }
      if (priority !== null) { params.push(priority); conds.push(`priority = $${params.length}`); }
      const whereSql = conds.join(" AND ");

      const [byStatus, byPriority, byTaskType] = await Promise.all([
        qRead(`SELECT status, count(*)::int as count FROM business.ops_task GROUP BY status ORDER BY count DESC`),
        qRead(`SELECT priority, count(*)::int as count FROM business.ops_task GROUP BY priority ORDER BY priority DESC NULLS LAST`),
        qRead(`SELECT COALESCE(task_type, 'review') as task_type, count(*)::int as count
             FROM business.ops_task WHERE ${whereSql}
             GROUP BY task_type ORDER BY count DESC`, params),
      ]);
      res.json({ by_status: byStatus, by_priority: byPriority, by_task_type: byTaskType });
    } catch (error) {
      next(error);
    }
  });

  // ---------- Q3 任务状态切换 PATCH ----------
  // 状态机：API 对外三态 open / in_progress / done；内部 done 映射为 DB 的 closed（与 ops_task_status_check 对齐）
  const ALLOWED_STATUS = ["open", "in_progress", "done"] as const;
  type TaskStatus = typeof ALLOWED_STATUS[number];
  const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
    open:        ["in_progress", "done"],
    in_progress: ["done", "open"],
    done:        ["open", "in_progress"], // 允许回退，保留灵活
  };
  // API 三态 ↔ DB 实存值
  const toDbStatus  = (s: TaskStatus): string => s === "done" ? "closed" : s;
  const toApiStatus = (s: string | null | undefined): TaskStatus => {
    const v = String(s || "").toLowerCase();
    if (v === "closed" || v === "done") return "done";
    if (v === "in_progress" || v === "doing" || v === "claimed") return "in_progress";
    return "open";
  };

  app.patch("/api/tasks/:id/status", async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const nextStatus = String(req.body?.status || "").toLowerCase() as TaskStatus;
      const owner    = req.body?.owner    ? String(req.body.owner).slice(0, 64)    : null;
      const doneNote = req.body?.done_note ? String(req.body.done_note).slice(0, 500) : null;

      if (!ALLOWED_STATUS.includes(nextStatus)) {
        return res.status(400).json({ error: `status 必须为 ${ALLOWED_STATUS.join("/")}` });
      }

      // 取当前状态
      const cur = await q<{ status: string }>(
        `SELECT status FROM business.ops_task WHERE id = $1::uuid`, [id]
      );
      if (cur.length === 0) return res.status(404).json({ error: "任务不存在" });
      const curStatus = toApiStatus(cur[0].status);
      if (!TRANSITIONS[curStatus]?.includes(nextStatus)) {
        return res.status(422).json({
          error: `不允许的状态转换：${curStatus} → ${nextStatus}`
        });
      }

      // 写入（根据目标状态额外时间戳），DB 存值经 toDbStatus 映射
      const sets: string[] = ["status = $1", "updated_at = now()"];
      const params: any[] = [toDbStatus(nextStatus)];
      if (nextStatus === "in_progress") {
        sets.push("claimed_at = COALESCE(claimed_at, now())");
        // v1.6: 接手时自动将 owner 设为当前登录用户(如果未传 owner)
        const sessUser2 = (req as any).session?.user as { username: string } | undefined;
        const targetOwner = owner || sessUser2?.username || null;
        if (targetOwner) { params.push(targetOwner); sets.push(`owner = $${params.length}`); }
      }
      if (nextStatus === "done") {
        sets.push("done_at = now()", "closed_at = now()");
        if (doneNote) { params.push(doneNote); sets.push(`done_note = $${params.length}`); }
      }
      if (nextStatus === "open") {
        sets.push("claimed_at = NULL", "done_at = NULL", "closed_at = NULL");
      }

      params.push(id);
      const sql = `UPDATE business.ops_task SET ${sets.join(", ")} WHERE id = $${params.length}::uuid RETURNING id, status, owner, claimed_at, done_at, done_note, updated_at`;
      const rows = await q<any>(sql, params);
      // 对外回传统一 API 三态
      const t = rows[0];
      if (t) t.status = toApiStatus(t.status);
      res.json({ ok: true, task: t });
    } catch (error) {
      next(error);
    }
  });

  // v1.6 改进2: PATCH /api/tasks/:id/assign—— 仅 admin 可指派任务给某个 operator
  app.patch("/api/tasks/:id/assign", async (req, res, next) => {
    try {
      const sessUser = (req as any).session?.user as { username: string; role: string } | undefined;
      if (!sessUser) return res.status(401).json({ error: "未登录" });
      if (sessUser.role !== "admin") return res.status(403).json({ error: "仅运营主管可以指派任务" });

      const { id } = req.params;
      const { owner } = req.body || {};
      // owner = null / 空字符串 → 释放回任务池; 否则指派给该 username
      const newOwner = owner === null || owner === "" || owner === undefined ? null : String(owner).trim();

      // 验证 target user 存在且 active
      if (newOwner) {
        const uRows = await q<{ role: string; is_active: boolean }>(
          `SELECT role, is_active FROM business_ext.app_user_ext WHERE username = $1`,
          [newOwner]
        );
        if (uRows.length === 0) return res.status(404).json({ error: `账号 ${newOwner} 不存在` });
        if (!uRows[0].is_active) return res.status(400).json({ error: `账号 ${newOwner} 已停用` });
      }

      const rows = await q<any>(
        `UPDATE business.ops_task
           SET owner = $1::text, updated_at = now(),
               claimed_at = CASE WHEN $1::text IS NOT NULL THEN COALESCE(claimed_at, now()) ELSE claimed_at END
         WHERE id = $2::uuid
       RETURNING id, status, owner, claimed_at`,
        [newOwner, id]
      );
      if (rows.length === 0) return res.status(404).json({ error: "任务不存在" });
      const t = rows[0];
      t.status = toApiStatus(t.status);
      res.json({ ok: true, task: t });
    } catch (error) {
      next(error);
    }
  });

  // v1.7: PATCH /api/tasks/batch/assign—— 批量指派(仅 admin)
  // body: { task_ids?: string[], skus?: string[], task_type?: string, owner: string }
  // 可直接指定 task_ids,或 按 SKU 列表批量,或 按 任务类型批量(按分类一键)
  app.patch("/api/tasks/batch/assign", async (req, res, next) => {
    try {
      const sessUser = (req as any).session?.user as { username: string; role: string } | undefined;
      if (!sessUser) return res.status(401).json({ error: "未登录" });
      if (sessUser.role !== "admin") return res.status(403).json({ error: "仅运营主管可以指派任务" });

      const body = req.body || {};
      const rawOwner = body.owner;
      const newOwner = rawOwner === null || rawOwner === "" || rawOwner === undefined ? null : String(rawOwner).trim();
      const taskIds: string[] = Array.isArray(body.task_ids) ? body.task_ids.filter(Boolean).map(String) : [];
      const skus: string[] = Array.isArray(body.skus) ? body.skus.filter(Boolean).map((s: any) => String(s).trim()) : [];
      const taskType: string | null = body.task_type ? String(body.task_type) : null;
      const onlyUnassigned = body.only_unassigned === true || body.only_unassigned === "true";

      if (taskIds.length === 0 && skus.length === 0 && !taskType) {
        return res.status(400).json({ error: "必须提供 task_ids / skus / task_type 之一" });
      }

      // 验证 target user
      if (newOwner) {
        const uRows = await q<{ role: string; is_active: boolean }>(
          `SELECT role, is_active FROM business_ext.app_user_ext WHERE username = $1`,
          [newOwner]
        );
        if (uRows.length === 0) return res.status(404).json({ error: `账号 ${newOwner} 不存在` });
        if (!uRows[0].is_active) return res.status(400).json({ error: `账号 ${newOwner} 已停用` });
      }

      // 构造 WHERE
      const params: any[] = [newOwner];
      let where = "1=1";
      if (taskIds.length > 0) {
        params.push(taskIds);
        where += ` AND id = ANY($${params.length}::uuid[])`;
      }
      if (skus.length > 0) {
        params.push(skus);
        where += ` AND sku = ANY($${params.length}::text[])`;
      }
      if (taskType) {
        // 根据 SKU 的当前分类过滤(同 Workbench Tab 逻辑)
        params.push(taskType);
        where += ` AND sku IN (SELECT sku FROM business.sku_master WHERE current_type_code = $${params.length})`;
      }
      if (onlyUnassigned) {
        where += " AND owner IS NULL";
      }
      // 只指派未完成的任务(已完成不变)
      where += " AND status IN ('todo','doing')";

      const rows = await q<any>(
        `UPDATE business.ops_task
            SET owner = $1::text, updated_at = now(),
                claimed_at = CASE WHEN $1::text IS NOT NULL THEN COALESCE(claimed_at, now()) ELSE claimed_at END
          WHERE ${where}
        RETURNING id, sku, owner`,
        params
      );
      res.json({ ok: true, updated_count: rows.length, tasks: rows });
    } catch (error) {
      next(error);
    }
  });

  // ---------- ② SKU 分类分布 ----------
  app.get("/api/types", async (_req, res, next) => {
    try {
      const rows = await qRead(`
        SELECT d.type_code, d.name_zh, d.category, d.display_color, d.priority, d.description,
               d.threshold_json,
               COALESCE(m.cnt, 0)::int as sku_count
        FROM business.sku_type_dict d
        LEFT JOIN (
          SELECT current_type_code, count(*) as cnt
          FROM business.sku_master
          WHERE current_type_code IS NOT NULL
          GROUP BY current_type_code
        ) m ON m.current_type_code = d.type_code
        WHERE d.is_active = true
        ORDER BY d.priority ASC
      `);
      res.json({ types: rows });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/types/:type_code/skus", async (req, res, next) => {
    try {
      const { page, pageSize } = parsePagination(req.query, [20], 20);
      const query = async <T = unknown>(
        sql: string,
        params: unknown[] = [],
      ): Promise<T[]> => qRead<T>(sql, params);
      const readModelEnabled = resolveTaskReadModelEnabled();
      const dependencies = createTypeSkuPageDependencies(
        query,
        (skus) => loadTypeOperatingFields({
          readModelEnabled,
          contractVersion: TASK_OPERATING_CONTRACT_VERSION,
          loadReadModel: (requestedSkus) => loadReadModelFields(
            query,
            requestedSkus,
            TASK_OPERATING_CONTRACT_VERSION,
          ),
          loadLegacy: (requestedSkus) =>
            loadEtlSnapshotOperatingFields(query, requestedSkus),
          onReadModelError: (error) => {
            const message = error instanceof Error
              ? error.message
              : String(error);
            console.error(`[type-read-model] request issue: ${message}`);
          },
        }, skus),
      );
      res.json(await loadTypeSkuPage(
        dependencies,
        routeParam(req.params.type_code),
        page,
        pageSize,
      ));
    } catch (error) {
      next(error);
    }
  });

  // ---------- AI 3A 统一读取 ----------
  app.get("/api/skus/:sku/ai-analysis", requireAuth, async (req, res, next) => {
    try {
      res.json(await buildAiAnalysisResponse(
        aiRepository,
        routeParam(req.params.sku),
        { includeHistory: false },
      ));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/skus/:sku/ai/history", requireAuth, async (req, res, next) => {
    try {
      res.json(await buildAiHistoryResponse(
        aiRepository,
        routeParam(req.params.sku),
      ));
    } catch (error) {
      next(error);
    }
  });

  app.get(
    "/api/skus/:sku/ai/history/:analysisId",
    requireAuth,
    async (req, res, next) => {
      try {
        const row = await aiRepository.findUsableById(
          routeParam(req.params.sku),
          routeParam(req.params.analysisId),
        );
        if (!row) {
          res.status(404).json({
            error: {
              code: "AI_HISTORY_NOT_FOUND",
              message: "未找到该历史分析",
              retryable: false,
            },
          });
          return;
        }
        const normalized = normalizeStoredAnalysisRecord(row);
        res.json({
          analysis: normalized.payload,
          meta: {
            analysis_id: row.analysis_id,
            analysis_status: normalized.status,
            analysis_time: row.finished_at ?? row.created_at,
            model_name: row.model_name,
            iso_year: row.iso_year,
            iso_week: row.iso_week,
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  // ---------- SKU 详情拆分读取 ----------
  app.get("/api/skus/:sku/summary", requireAuth, async (req, res, next) => {
    try {
      res.json(await loadSummary(routeParam(req.params.sku)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/skus/:sku/buybox", requireAuth, async (req, res, next) => {
    try {
      const { page, pageSize } = parsePagination(req.query, [10], 10);
      const data = await loadSkuBuybox(
        qRead,
        routeParam(req.params.sku),
        page,
        pageSize,
      );
      res.json({
        ...data,
        ...pageMeta(data.competitor_total, page, pageSize),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/skus/:sku/tasks", requireAuth, async (req, res, next) => {
    try {
      res.json(await loadSkuTasks(qRead, routeParam(req.params.sku), {
        translateReason,
        sanitizeText,
      }));
    } catch (error) {
      next(error);
    }
  });

  app.get(
    "/api/skus/:sku/transitions",
    requireAuth,
    async (req, res, next) => {
      try {
        res.json(await loadSkuTransitions(qRead, routeParam(req.params.sku), {
          translateReason,
        }));
      } catch (error) {
        next(error);
      }
    },
  );

  // ---------- SKU 详情(含 AI 解析 + 商品信息) ----------
  app.get("/api/skus/:sku", requireAuth, async (req, res, next) => {
    try {
      const sku = routeParam(req.params.sku);
      const includeAi = req.query.include_ai !== "0";
      const [
        summary,
        weeklyHistory,
        aiResponse,
        taskData,
        transitionData,
        buyboxData,
      ] = await Promise.all([
        loadSummary(sku),
        loadSkuWeeklyHistory(qRead, sku),
        includeAi
          ? buildAiAnalysisResponse(aiRepository, sku)
          : Promise.resolve(null),
        loadSkuTasks(qRead, sku, { translateReason, sanitizeText }),
        loadSkuTransitions(qRead, sku, { translateReason }),
        loadSkuBuybox(qRead, sku, 1, 20),
      ]);
      const compatibleAi = aiResponse
        ? toLegacyAiDetail(aiResponse)
        : { latest_ai: null, ai_history: [] };

      res.json({
        master: summary.master,
        latest_weekly: summary.latest_weekly,
        weekly_history: weeklyHistory,
        latest_ai: compatibleAi.latest_ai,
        ai_history: compatibleAi.ai_history,
        tasks: taskData.tasks,
        transitions: transitionData.transitions,
        fb_hint: null,
        buybox: buyboxData.listings,
        competitors: buyboxData.competitors,
      });
    } catch (error) {
      next(error);
    }
  });

  // ---------- Q7: 运营回填我方售价 our_price ----------
  app.patch("/api/skus/:sku/our-price", requireAuth, async (req, res, next) => {
    try {
      const sku = req.params.sku;
      const { meli_id, our_price, note } = req.body || {};
      if (!meli_id || our_price == null || Number.isNaN(Number(our_price))) {
        res.status(400).json({ error: "meli_id 与 our_price 必传" });
        return;
      }
      const price = Number(our_price);
      if (price <= 0) {
        res.status(400).json({ error: "our_price 必须 > 0" });
        return;
      }
      await q(
        `INSERT INTO business_ext.sku_buybox_our_price_override (sku, meli_id, our_price, note, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (sku, meli_id) DO UPDATE
         SET our_price = EXCLUDED.our_price,
             note = EXCLUDED.note,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
        [sku, meli_id, price, note || null, req.session.user!.username],
      );
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  // ---------- AI 深度解析:刷新 ----------
  app.post("/api/skus/:sku/ai-refresh", requireAuth, async (req, res, next) => {
    try {
      const sku = routeParam(req.params.sku).trim();
      const existing = await qRead<{ sku: string }>(
        "SELECT sku FROM business.sku_master WHERE sku = $1 LIMIT 1",
        [sku],
      );
      if (!existing[0]) {
        res.status(404).json({ error: "SKU 不存在" });
        return;
      }
      const result = await coreClient.refreshSku({
        sku,
        requestId: req.requestContext?.requestId || "request-context-missing",
        actorId: req.session.user!.id,
      });
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof CoreUnavailableError || error instanceof CoreProtocolError) {
        res.status(503).json({
          status: "core_unavailable",
          message: "AI 分析核心暂时不可用，历史分析仍可查看",
        });
        return;
      }
      next(error);
    }
  });

  // ---------- ③ 流转分析:任意周区间 ----------
  app.get("/api/transitions", requireAuth, async (req, res, next) => {
    try {
      const { page, pageSize } = parsePagination(req.query, [20], 20);
      const data = await loadTransitionGroupPage(
        transitionListDependencies,
        parseTransitionRange(req.query),
        page,
        pageSize,
      );
      for (const group of data.groups) {
        group.primary_reason = translateReason(
          group.primary_reason_raw as string | null | undefined,
        );
        delete group.primary_reason_raw;
      }
      res.json(data);
    } catch (error) {
      next(error);
    }
  });

  app.get(
    "/api/transitions/:sku/history",
    requireAuth,
    async (req, res, next) => {
      try {
        const rows = await loadTransitionHistory(
          transitionListDependencies,
          routeParam(req.params.sku),
          parseTransitionRange(req.query),
        );
        for (const row of rows) {
          row.primary_reason = translateReason(
            row.primary_reason_raw as string | null | undefined,
          );
          delete row.primary_reason_raw;
        }
        res.json({ transitions: rows });
      } catch (error) {
        next(error);
      }
    },
  );

  app.get("/api/transitions/matrix", async (req, res, next) => {
    try {
      const { where, params } = buildTransitionRangeWhere(
        parseTransitionRange(req.query),
      );
      const [cells, kinds, weeks] = await Promise.all([
        qRead(
          `SELECT t.from_type_code, t.to_type_code, count(*)::int as count,
                  df.name_zh as from_name, df.display_color as from_color,
                  dt.name_zh as to_name, dt.display_color as to_color
           FROM business.sku_classification_transition t
           LEFT JOIN business.sku_type_dict df ON df.type_code = t.from_type_code
           LEFT JOIN business.sku_type_dict dt ON dt.type_code = t.to_type_code
           WHERE ${where}
           GROUP BY t.from_type_code, t.to_type_code, df.name_zh, df.display_color, dt.name_zh, dt.display_color
           ORDER BY count DESC LIMIT 200`,
          params,
        ),
        qRead(
          `SELECT transition_kind, count(*)::int as count
           FROM business.sku_classification_transition t WHERE ${where}
           GROUP BY t.transition_kind ORDER BY count DESC`,
          params,
        ),
        qRead(
          `SELECT t.to_iso_year as year, t.to_iso_week as week, count(*)::int as count
           FROM business.sku_classification_transition t WHERE ${where}
           GROUP BY t.to_iso_year, t.to_iso_week
           ORDER BY t.to_iso_year DESC, t.to_iso_week DESC LIMIT 26`,
          params,
        ),
      ]);
      res.json({ matrix: cells, kinds, weeks });
    } catch (error) {
      next(error);
    }
  });

  // 可选时间范围
  app.get("/api/transitions/week-range", async (_req, res, next) => {
    try {
      const rows = await qRead(
        `SELECT DISTINCT to_iso_year as year, to_iso_week as week
         FROM business.sku_classification_transition
         WHERE 1=1${anchorIsoWeekLimit("", "to_iso_year", "to_iso_week")}
         ORDER BY year DESC, week DESC LIMIT 52`,
      );
      res.json({ weeks: rows });
    } catch (error) {
      next(error);
    }
  });

  return httpServer;
}
