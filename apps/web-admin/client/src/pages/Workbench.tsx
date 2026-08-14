import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import SkuDetailDrawer from "@/components/SkuDetailDrawer";
import { HelpCircle, Package, PieChart as PieChartIcon, ArrowRightLeft, ClipboardCheck, ImageOff, Store, Tag, Sparkles, Loader2, PlayCircle, CheckCircle2, RotateCcw, UserPlus, Users, ClipboardPaste, CheckSquare, Square, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { presentMetric, type MetricKind, type MetricStatus } from "@/lib/metricPresentation";
import AsyncState from "@/components/AsyncState";
import PaginationControls, { getDisplayedPagination } from "@/components/PaginationControls";

// 短格式化(任务卡内至少四列,保持紧凑)
const fmtCLPShort = (n: number | null | undefined): string => {
  if (n === null || n === undefined || isNaN(Number(n))) return "—";
  const v = Number(n);
  if (v === 0) return "$0";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
};
const fmtPctShort = (n: number | null | undefined, dp = 1): string => {
  if (n === null || n === undefined || isNaN(Number(n))) return "—";
  return `${(Number(n) * 100).toFixed(dp)}%`;
};
const fmtDaysShort = (n: number | null | undefined): string => {
  if (n === null || n === undefined || isNaN(Number(n))) return "—";
  const v = Number(n);
  if (v < 1) return "今日";
  return `${Math.round(v)} 天`;
};

const presentMetricShort = (
  kind: MetricKind,
  value: number | null | undefined,
  status: MetricStatus | null | undefined,
): string => {
  const resolvedStatus = status ?? "observed";
  if (value === null || value === undefined || resolvedStatus !== "observed") {
    return presentMetric(kind, value, resolvedStatus);
  }
  if (kind === "turnover" && Number(value) === 999) {
    return presentMetric(kind, value, resolvedStatus);
  }
  if (kind === "gmv") return fmtCLPShort(value);
  if (kind === "turnover") return fmtDaysShort(value);
  return fmtPctShort(value, kind === "claim_rate" ? 2 : 1);
};

type Overview = {
  total_sku: number;
  latest_week: string | null;
  latest_week_classified: number;
  task_pending: number;
  task_claimed: number;
  task_done: number;
  total_transitions: number;
};

type Task = {
  id: string;
  sku: string;
  product_name: string | null;
  image_url: string | null;
  brand_name: string | null;
  primary_shop: string | null;
  current_type_code: string | null;
  type_name: string | null;
  type_color: string | null;
  iso_year: number;
  iso_week: number;
  metric_iso_year: number | null;
  metric_iso_week: number | null;
  task_type: string | null;
  priority: number | null;
  title: string | null;
  reason_summary: string | null;
  expected_impact: string | null;
  status: string;
  owner: string | null;
  due_date: string | null;
  created_at: string;
  weekly_gmv: number | null;
  profit_margin: number | null;
  turnover_days: number | null;
  claim_rate: number | null;
  weekly_gmv_status: MetricStatus | null;
  profit_margin_status: MetricStatus | null;
  turnover_status: MetricStatus | null;
  claim_rate_status: MetricStatus | null;
  ai_score?: number;
  ai_reason?: string;
};

type TaskPageResponse = {
  tasks: Task[];
  total: number;
  page: number;
  page_size: number;
};

const statusExplain: Record<string, string> = {
  ALL: "全部任务(所有状态)",
  open: "待处理:尚未被认领执行的任务",
  in_progress: "处理中:已经有人认领,正在推进",
  done: "已完成:任务已闭环",
};

const priorityBadge = (p: number | null) => {
  if (p === 3) return <Badge className="bg-rose-100 text-rose-700 border-rose-200 hover:bg-rose-100">紧急</Badge>;
  if (p === 2) return <Badge className="bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100">关注</Badge>;
  if (p === 1) return <Badge className="bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-100">常规</Badge>;
  return <Badge variant="outline">未定级</Badge>;
};

const statusBadge = (s: string | null | undefined) => {
  const v = String(s || "").toLowerCase();
  if (v === "in_progress") return <Badge className="bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-100">处理中</Badge>;
  if (v === "done") return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">已完成</Badge>;
  return <Badge className="bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100">待处理</Badge>;
};

const weekLabel = (y: number, w: number) => `${y} 年第 ${String(w).padStart(2, "0")} 周`;
const liveDataQueryOptions = {
  staleTime: 60_000,
  refetchOnWindowFocus: true,
} as const;

// Q5 SOP V3 6 大任务类型（+ review 兵底）
const TASK_TYPE_META: Record<string, { zh: string; hint: string; color: string }> = {
  purchase_restock: { zh: "补采购",     hint: "本地仓库存 &lt; 45 天, 需国内下单",   color: "text-blue-700 bg-blue-50 border-blue-200" },
  full_restock:     { zh: "补 Full",   hint: "Full 仓 &lt; 7 天, 仅补发美客多仓",         color: "text-cyan-700 bg-cyan-50 border-cyan-200" },
  price_adjust:     { zh: "调价",       hint: "毛利率偏低 / 批量低 / 需重定价",       color: "text-violet-700 bg-violet-50 border-violet-200" },
  ads_adjust:       { zh: "广告",       hint: "ACOS / 预算 / 明星广告优化",           color: "text-fuchsia-700 bg-fuchsia-50 border-fuchsia-200" },
  promotion_manage: { zh: "促销",       hint: "高库存 / 滞销 / 清货, 行为只能是促销", color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  listing_optimize: { zh: "Listing 优化", hint: "新品 / 高赔付 / 描述图片优化",     color: "text-orange-700 bg-orange-50 border-orange-200" },
  review:           { zh: "周复盘",     hint: "兼底：需人工判定具体行为",           color: "text-slate-700 bg-slate-50 border-slate-200" },
};
const TASK_TYPE_ORDER = ["purchase_restock","full_restock","price_adjust","ads_adjust","promotion_manage","listing_optimize","review"] as const;
const taskTypeZh = (code: string | null | undefined) => {
  if (!code) return "周复盘";
  return TASK_TYPE_META[code]?.zh || code.replace(/_/g, " ");
};

export default function Workbench() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("open");
  const [priority, setPriority] = useState<string>("ALL");
  const [taskType, setTaskType] = useState<string>("ALL");  // v1.6 二级 Tab
  const [selSku, setSelSku] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<"default" | "ai">("default");
  // v1.9 分页 + 搜索 (2026-08-05)
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [searchInput, setSearchInput] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>(""); // debounced
  // v1.7: 指派可见性 + 批量指派
  const [ownerFilter, setOwnerFilter] = useState<"all" | "unassigned" | "assigned" | "mine">("all");
  const outOfRangeRecoveryKeyRef = useRef<string | null>(null);
  // 筛选变化时自动回到第一页
  useEffect(() => {
    setPage(1);
    outOfRangeRecoveryKeyRef.current = null;
  }, [status, priority, taskType, sortMode, ownerFilter, searchQuery, pageSize]);
  // search 防抖(300ms)
  useEffect(() => {
    const h = setTimeout(() => setSearchQuery(searchInput.trim()), 300);
    return () => clearTimeout(h);
  }, [searchInput]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchOwnerFor, setBatchOwnerFor] = useState<"selection" | "category" | "paste" | null>(null);
  const [pasteSkuText, setPasteSkuText] = useState("");

  const { data: overview } = useQuery<Overview>({
    queryKey: ["/api/overview"],
    ...liveDataQueryOptions,
  });

  // v1.6 当前状态+优先级筛选下的各 task_type 计数(用于二级 Tab 展示)
  const { data: taskStats } = useQuery<{ by_task_type: { task_type: string; count: number }[] }>({
    queryKey: ["/api/tasks/stats", status, priority],
    ...liveDataQueryOptions,
    queryFn: async () => {
      const p = new URLSearchParams();
      if (status && status !== "ALL") p.set("status", status);
      if (priority && priority !== "ALL") p.set("priority", priority);
      const r = await apiRequest("GET", `/api/tasks/stats?${p.toString()}`);
      return r.json();
    },
  });
  const typeCounts: Record<string, number> = {};
  (taskStats?.by_task_type || []).forEach(r => { typeCounts[r.task_type] = r.count; });
  const totalCount = Object.values(typeCounts).reduce((a, b) => a + b, 0);

  const taskQueryKey = ["/api/tasks", status, priority, taskType, sortMode, ownerFilter, page, pageSize, searchQuery] as const;
  const taskRequestKey = JSON.stringify(taskQueryKey);
  const {
    data: taskData,
    error,
    isError,
    isLoading,
    isFetching,
    refetch,
  } = useQuery<TaskPageResponse, ApiError>({
    queryKey: taskQueryKey,
    ...liveDataQueryOptions,
    queryFn: async () => {
      const p = new URLSearchParams();
      if (status && status !== "ALL") p.set("status", status);
      if (priority && priority !== "ALL") p.set("priority", priority);
      if (taskType && taskType !== "ALL") p.set("task_type", taskType);
      if (sortMode === "ai") p.set("sort", "ai");
      if (ownerFilter && ownerFilter !== "all") p.set("owner_filter", ownerFilter);
      // v1.9 分页 + 搜索
      p.set("page", String(page));
      p.set("page_size", String(pageSize));
      if (searchQuery) p.set("search", searchQuery);
      const r = await apiRequest("GET", `/api/tasks?${p.toString()}`);
      return r.json();
    },
    placeholderData: (prev) => prev, // 保留上一页数据避免闪白
  });
  const lastTaskDataRef = useRef<TaskPageResponse | undefined>(undefined);
  useEffect(() => {
    if (taskData) lastTaskDataRef.current = taskData;
  }, [taskData]);
  useEffect(() => {
    if (
      !isError
      || !(error instanceof ApiError)
      || error.code !== "PAGE_OUT_OF_RANGE"
      || typeof error.last_page !== "number"
      || outOfRangeRecoveryKeyRef.current === taskRequestKey
    ) {
      return;
    }
    outOfRangeRecoveryKeyRef.current = taskRequestKey;
    setPage(error.last_page);
  }, [error, isError, taskRequestKey]);

  // Q3 任务状态切换 mutation
  const { user: authUser } = useAuth();
  const isAdmin = authUser?.role === "admin";

  // v1.6 admin 看到的可指派 operator 列表
  const { data: operatorsData } = useQuery<{ users: Array<{ username: string; display_name: string; role: string; is_active: boolean }> }>({
    queryKey: ["/api/users"],
    enabled: isAdmin,
  });
  const operatorOptions = (operatorsData?.users || []).filter(u => u.is_active);

  // v1.6 指派 mutation
  const assignMut = useMutation({
    mutationFn: async (args: { id: string; owner: string | null }) => {
      const r = await apiRequest("PATCH", `/api/tasks/${args.id}/assign`, { owner: args.owner });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "指派失败");
      return body;
    },
    onSuccess: (_, vars) => {
      toast({ title: vars.owner ? `已指派给 ${vars.owner}` : "已释放回任务池" });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/stats"] });
    },
    onError: (e: any) => toast({ title: "指派失败", description: e.message, variant: "destructive" as any }),
  });

  // v1.7: 批量指派 mutation
  const batchAssignMut = useMutation({
    mutationFn: async (args: { owner: string; payload: { task_ids?: string[]; skus?: string[]; task_type?: string; only_unassigned?: boolean } }) => {
      const r = await apiRequest("PATCH", "/api/tasks/batch/assign", { owner: args.owner, ...args.payload });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "批量指派失败");
      return body;
    },
    onSuccess: (data: any, vars) => {
      toast({ title: `批量指派完成`, description: `成功将 ${data.updated_count} 条任务指派给 ${vars.owner}` });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/stats"] });
      setSelectedIds(new Set());
      setSelectMode(false);
      setBatchOwnerFor(null);
      setPasteSkuText("");
    },
    onError: (e: any) => toast({ title: "批量指派失败", description: e.message, variant: "destructive" as any }),
  });

  const doBatchAssign = (owner: string) => {
    if (batchOwnerFor === "selection") {
      batchAssignMut.mutate({ owner, payload: { task_ids: Array.from(selectedIds) } });
    } else if (batchOwnerFor === "category") {
      // 按当前 Tab 分类一键指派(仅任务池)
      const tt = taskType !== "ALL" ? taskType : undefined;
      batchAssignMut.mutate({ owner, payload: { task_type: tt, only_unassigned: true } });
    } else if (batchOwnerFor === "paste") {
      const skus = pasteSkuText.split(/[\s,\n\t;\uFF0C\u3000]+/).map(s => s.trim()).filter(Boolean);
      if (skus.length === 0) {
        toast({ title: "未识别到 SKU", variant: "destructive" as any });
        return;
      }
      batchAssignMut.mutate({ owner, payload: { skus, only_unassigned: true } });
    }
  };

  const toggleSel = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const statusMut = useMutation({
    mutationFn: async (args: { id: string; next: "open" | "in_progress" | "done"; done_note?: string }) => {
      const r = await apiRequest("PATCH", `/api/tasks/${args.id}/status`, {
        status: args.next,
        done_note: args.done_note,
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "切换失败");
      return body;
    },
    onSuccess: (_, vars) => {
      const zh = vars.next === "in_progress" ? "接手" : vars.next === "done" ? "完成" : "释放";
      toast({ title: `任务已${zh}`, description: `状态已更新` });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
    },
    onError: (e: any) => toast({ title: "切换失败", description: e.message, variant: "destructive" as any }),
  });

  const visibleTaskData = taskData ?? lastTaskDataRef.current;
  const tasks = visibleTaskData?.tasks ?? [];
  const total = visibleTaskData?.total ?? tasks.length;
  const {
    displayedPage,
    displayedPageSize,
    lastPage,
    rangeStart,
    rangeEnd,
  } = getDisplayedPagination({
    total,
    page: visibleTaskData?.page ?? 1,
    page_size: visibleTaskData?.page_size ?? pageSize,
  });

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold" data-testid="text-workbench-title">运营工作台</h1>
        <p className="text-sm text-muted-foreground mt-1">
          今日任务进度 · 待处理 {overview?.task_pending ?? "—"} · 已完成 {overview?.task_done ?? 0}
        </p>
      </div>

      {/* KPI 卡片 - 可点击跳转 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <button
          onClick={() => navigate("/types")}
          className="text-left"
          data-testid="kpi-total-sku"
        >
          <Card className="p-5 hover:shadow-md hover:border-primary/40 transition-all cursor-pointer">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>在售 SKU 总数</span>
              <Package className="w-4 h-4" />
            </div>
            <div className="text-2xl font-semibold mt-2 tabular-nums" data-testid="value-total-sku">{overview?.total_sku ?? "—"}</div>
            <div className="text-xs text-muted-foreground mt-1">点击查看分类分布 →</div>
          </Card>
        </button>

        <button
          onClick={() => navigate("/types")}
          className="text-left"
          data-testid="kpi-latest-week"
        >
          <Card className="p-5 hover:shadow-md hover:border-primary/40 transition-all cursor-pointer">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>本周已分类</span>
              <PieChartIcon className="w-4 h-4" />
            </div>
            <div className="text-2xl font-semibold mt-2 tabular-nums" data-testid="value-latest-week">{overview?.latest_week_classified ?? "—"}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {overview?.latest_week ? weekLabel(Number(overview.latest_week.split("-W")[0]), Number(overview.latest_week.split("-W")[1])) : "—"}
            </div>
          </Card>
        </button>

        <a href="#task-list" data-testid="kpi-task-pending" className="text-left" onClick={(e) => { e.preventDefault(); setStatus("open"); document.getElementById("task-list")?.scrollIntoView({ behavior: "smooth" }); }}>
          <Card className="p-5 hover:shadow-md hover:border-primary/40 transition-all cursor-pointer">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>待处理任务</span>
              <ClipboardCheck className="w-4 h-4" />
            </div>
            <div className="text-2xl font-semibold mt-2 tabular-nums text-amber-700" data-testid="value-task-pending">{overview?.task_pending ?? "—"}</div>
            <div className="text-xs text-muted-foreground mt-1">已完成 {overview?.task_done ?? 0}</div>
          </Card>
        </a>

        <button
          onClick={() => navigate("/transitions")}
          className="text-left"
          data-testid="kpi-transitions"
        >
          <Card className="p-5 hover:shadow-md hover:border-primary/40 transition-all cursor-pointer">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>累计流转</span>
              <ArrowRightLeft className="w-4 h-4" />
            </div>
            <div className="text-2xl font-semibold mt-2 tabular-nums" data-testid="value-transitions">{overview?.total_transitions ?? "—"}</div>
            <div className="text-xs text-muted-foreground mt-1">点击查看迁移分析 →</div>
          </Card>
        </button>
      </div>

      {/* 任务列表 */}
      <div id="task-list">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-medium">任务列表</h2>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">状态</span>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-32 h-8 text-xs" data-testid="select-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">全部</SelectItem>
                  <SelectItem value="open">待处理</SelectItem>
                  <SelectItem value="in_progress">处理中</SelectItem>
                  <SelectItem value="done">已完成</SelectItem>
                </SelectContent>
              </Select>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button data-testid="help-status" className="text-muted-foreground hover:text-foreground"><HelpCircle className="w-4 h-4" /></button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <div className="text-xs space-y-1">
                    <div><b>待处理</b>:任务已生成,尚未有人认领</div>
                    <div><b>处理中</b>:已被认领,正在执行动作</div>
                    <div><b>已完成</b>:任务已闭环归档</div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">优先级</span>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="w-32 h-8 text-xs" data-testid="select-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">全部</SelectItem>
                  <SelectItem value="3">紧急</SelectItem>
                  <SelectItem value="2">关注</SelectItem>
                  <SelectItem value="1">常规</SelectItem>
                </SelectContent>
              </Select>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button data-testid="help-priority" className="text-muted-foreground hover:text-foreground"><HelpCircle className="w-4 h-4" /></button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-sm">
                  <div className="text-xs space-y-1.5">
                    <div className="font-medium mb-1">优先级判定(SOP V3)</div>
                    <div><b className="text-rose-700">紧急</b>:命中任一 —— 售后率 ≥ 5%、周转 &gt; 180 天(极度滞销)、Full 断货 &lt; 7 天、爆款下滑 30%+、毛利率跌破 0</div>
                    <div><b className="text-amber-700">关注</b>:周转 91-180 天、毛利率 10-15% 且下滑、新品孵化第 2-3 阶段落后、竞品夺 Buybox</div>
                    <div><b className="text-slate-700">常规</b>:周复盘、季节切换、可选优化(周转 45-90 且毛利率 ≥ 15%)</div>
                    <div className="pt-1 text-muted-foreground">同优先级下按周 GMV 降序;AI 智能排序会额外综合业务价值和拖延成本</div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between mb-3 gap-3">
          <div className="text-xs text-muted-foreground">
            {isLoading && !visibleTaskData ? (
              <>正在加载第 {page} 页</>
            ) : (
              <>共 {total} 条任务；当前显示第 {rangeStart}—{rangeEnd} 条；第 {displayedPage}/{lastPage} 页</>
            )}
            {sortMode === "ai" && !isLoading && (
              <span className="ml-2 text-primary">· 已按处理价值排序</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={sortMode === "ai" ? "default" : "outline"}
              onClick={() => {
                const next = sortMode === "ai" ? "default" : "ai";
                setSortMode(next);
                if (next === "ai") {
                  toast({
                    title: "AI 智能排序已开启",
                    description: "综合业务价值、紧迫度、影响面自动排序，每个任务卡会显示“为什么排在前面”。",
                  });
                }
              }}
              data-testid="button-ai-sort"
              className="h-8 text-xs"
            >
              {isFetching && sortMode === "ai" ? (
                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 mr-1" />
              )}
              {sortMode === "ai" ? "AI 智能排序中" : "AI 智能排序"}
            </Button>
          </div>
        </div>

        {/* v1.7: admin 指派可见性与批量指派工具栏 */}
        {isAdmin && (
          <div className="flex items-center flex-wrap gap-2 mb-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2" data-testid="admin-toolbar">
            <span className="text-xs text-muted-foreground shrink-0">指派可见性</span>
            <div className="inline-flex rounded-md overflow-hidden border border-border">
              {([
                { k: "all", label: "全部" },
                { k: "unassigned", label: "任务池" },
                { k: "assigned", label: "已指派" },
                { k: "mine", label: "我指派的" },
              ] as const).map(o => (
                <button
                  key={o.k}
                  type="button"
                  onClick={() => setOwnerFilter(o.k)}
                  className={`px-3 h-7 text-xs transition-colors ${ownerFilter === o.k ? "bg-primary text-primary-foreground" : "bg-white text-foreground hover:bg-muted"}`}
                  data-testid={`owner-filter-${o.k}`}
                >{o.label}</button>
              ))}
            </div>

            <span className="mx-2 text-muted-foreground/40">|</span>

            <Button
              size="sm"
              variant={selectMode ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => { setSelectMode(v => !v); setSelectedIds(new Set()); }}
              data-testid="btn-toggle-select-mode"
            >
              {selectMode ? <CheckSquare className="w-3.5 h-3.5 mr-1" /> : <Square className="w-3.5 h-3.5 mr-1" />}
              {selectMode ? `多选中 (${selectedIds.size})` : "多选"}
            </Button>

            {selectMode && selectedIds.size > 0 && (
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => setBatchOwnerFor("selection")}
                data-testid="btn-batch-assign-selection"
              >
                <UserPlus className="w-3.5 h-3.5 mr-1" />指派选中 {selectedIds.size} 项
              </Button>
            )}

            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setBatchOwnerFor("category")}
              disabled={taskType === "ALL"}
              title={taskType === "ALL" ? "请先在下方选择一个任务类别 Tab" : "一键指派当前分类下所有任务池 SKU"}
              data-testid="btn-batch-assign-category"
            >
              <Users className="w-3.5 h-3.5 mr-1" />按分类一键
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => { setPasteSkuText(""); setBatchOwnerFor("paste"); }}
              data-testid="btn-batch-assign-paste"
            >
              <ClipboardPaste className="w-3.5 h-3.5 mr-1" />粘贴 SKU 列表
            </Button>

            {batchAssignMut.isPending && (
              <span className="inline-flex items-center text-xs text-muted-foreground"><Loader2 className="w-3 h-3 mr-1 animate-spin" />执行中</span>
            )}
          </div>
        )}

        {/* v1.6 二级 Tab —— 6 大任务类型 + 全部, 始终显示 */}
        <div className="flex items-center gap-1 border-b border-border mb-4 overflow-x-auto" data-testid="task-type-tabs">
          <button
            type="button"
            onClick={() => setTaskType("ALL")}
            className={`px-4 py-2 text-sm border-b-2 transition-colors whitespace-nowrap ${
              taskType === "ALL"
                ? "border-primary text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            data-testid="task-type-tab-ALL"
          >
            全部 <span className="ml-1 text-xs tabular-nums opacity-70">{totalCount}</span>
          </button>
          {TASK_TYPE_ORDER.filter(k => k !== "review").map((k) => {
            const meta = TASK_TYPE_META[k];
            const count = typeCounts[k] || 0;
            const active = taskType === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setTaskType(k)}
                className={`px-4 py-2 text-sm border-b-2 transition-colors whitespace-nowrap ${
                  active
                    ? "border-primary text-foreground font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`task-type-tab-${k}`}
                title={meta.hint.replace(/&lt;/g, "<").replace(/&gt;/g, ">")}
              >
                {meta.zh} <span className="ml-1 text-xs tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>

        {/* 当前 Tab 提示 */}
        {taskType !== "ALL" && TASK_TYPE_META[taskType] && (
          <div className="mb-3 text-xs text-muted-foreground" dangerouslySetInnerHTML={{ __html: `当前类别重点：${TASK_TYPE_META[taskType].hint}` }} />
        )}

        {/* v1.9 搜索框 + 每页条数 */}
        <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="tasks-toolbar">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="搜索 SKU号 / 中文名 / 标题 / 品牌…"
            className="flex-1 min-w-[220px] max-w-md h-9 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            data-testid="input-task-search"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              className="text-xs text-muted-foreground hover:text-foreground px-2"
              data-testid="button-clear-search"
            >
              清除
            </button>
          )}
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <span>每页</span>
            <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
              <SelectTrigger className="h-9 w-[80px]" data-testid="select-page-size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
            <span>
              共 <span className="tabular-nums font-medium text-foreground" data-testid="text-total-count">{total}</span> 条
            </span>
          </div>
        </div>

        {isLoading && !visibleTaskData && (
          <AsyncState status="loading" message={`正在加载第 ${page} 页`} />
        )}

        {isError && (
          <AsyncState
            status="error"
            onRetry={() => { void refetch(); }}
            className={visibleTaskData ? "py-2 justify-start" : undefined}
          />
        )}

        {tasks.length === 0 && !isLoading && !isError && (
          <div className="text-center text-sm text-muted-foreground py-12" data-testid="empty-tasks">
            {searchQuery
              ? `未找到包含 “${searchQuery}” 的任务`
              : (taskType === "ALL" ? "当前筛选下没有任务" : `“${TASK_TYPE_META[taskType]?.zh || taskType}”分类下没有任务`)}
          </div>
        )}

        <div className="relative">
          {isFetching && visibleTaskData && (
            <Badge className="absolute left-1/2 top-2 z-10 -translate-x-1/2 gap-1.5 shadow-sm" aria-live="polite">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              正在加载第 {page} 页
            </Badge>
          )}
          <div className={`grid grid-cols-1 lg:grid-cols-2 gap-3 transition-opacity ${isFetching && visibleTaskData ? "opacity-50 pointer-events-none" : "opacity-100"}`}>
            {tasks.map((t) => {
            const curStatus = String(t.status || "open").toLowerCase();
            const isPending = statusMut.isPending;
            return (
              <Card key={t.id} className={`p-4 hover:shadow-md transition-all h-full ${selectMode && selectedIds.has(t.id) ? "border-primary ring-2 ring-primary/30" : "hover:border-primary/40"}`} data-testid={`task-card-${t.sku}`}>
                <div className="flex gap-3">
                  {selectMode && isAdmin && (
                    <button
                      type="button"
                      onClick={() => toggleSel(t.id)}
                      className="shrink-0 self-start pt-1"
                      data-testid={`sel-checkbox-${t.sku}`}
                    >
                      {selectedIds.has(t.id) ? <CheckSquare className="w-5 h-5 text-primary" /> : <Square className="w-5 h-5 text-muted-foreground" />}
                    </button>
                  )}
                  {/* 商品图 */}
                  <button onClick={() => setSelSku(t.sku)} className="w-20 h-20 shrink-0 rounded-md bg-muted overflow-hidden flex items-center justify-center hover:opacity-90" data-testid={`task-image-${t.sku}`}>
                    {t.image_url ? (
                      <img src={t.image_url} alt={t.product_name ?? t.sku} className="w-full h-full object-cover" onError={(e) => { (e.currentTarget.style.display = "none"); }} />
                    ) : (
                      <ImageOff className="w-6 h-6 text-muted-foreground" />
                    )}
                  </button>

                  {/* 主体内容 */}
                  <div className="flex-1 min-w-0">
                    <button onClick={() => setSelSku(t.sku)} className="w-full text-left" data-testid={`task-title-${t.sku}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-medium leading-snug line-clamp-2 flex-1">
                          {t.product_name || `(未命名 ${t.sku})`}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {statusBadge(curStatus)}
                          {priorityBadge(t.priority)}
                        </div>
                      </div>

                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
                        <span className="tabular-nums">SKU {t.sku}</span>
                        {t.primary_shop && (
                          <span className="inline-flex items-center gap-1"><Store className="w-3 h-3" />{t.primary_shop}</span>
                        )}
                        {t.type_name && (
                          <span className="inline-flex items-center gap-1">
                            <Tag className="w-3 h-3" />
                            <span style={{ color: `var(--color-${t.type_color || "slate"}-700, currentColor)` }}>{t.type_name}</span>
                          </span>
                        )}
                      </div>

                      <div className="mt-2 text-xs text-muted-foreground">
                        标记原因:<span className="text-foreground">{t.reason_summary || t.title || taskTypeZh(t.task_type)}</span>
                      </div>

                      {sortMode === "ai" && t.ai_reason && (
                        <div className="mt-1 text-xs flex items-start gap-1">
                          <Sparkles className="w-3 h-3 mt-0.5 shrink-0 text-primary" />
                          <span className="text-muted-foreground">为什么先处理:<span className="text-foreground ml-1">{t.ai_reason}</span></span>
                        </div>
                      )}

                      {t.expected_impact && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          预期影响:<span className="text-foreground">{t.expected_impact}</span>
                        </div>
                      )}

                      {/* 指标行 —— 周 GMV / 毛利率 / 周转 / 索赔率 */}
                      <div className="mt-2 grid grid-cols-4 gap-2 rounded-md bg-muted/40 px-2 py-1.5">
                        <div className="text-center">
                          <div className="text-[10px] text-muted-foreground">周 GMV</div>
                          <div className="text-xs font-medium tabular-nums">{presentMetricShort("gmv", t.weekly_gmv, t.weekly_gmv_status)}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-[10px] text-muted-foreground">毛利率</div>
                          <div className="text-xs font-medium tabular-nums">{presentMetricShort("margin", t.profit_margin, t.profit_margin_status)}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-[10px] text-muted-foreground">周转</div>
                          <div className="text-xs font-medium tabular-nums">{presentMetricShort("turnover", t.turnover_days, t.turnover_status)}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-[10px] text-muted-foreground">索赔率</div>
                          <div className="text-xs font-medium tabular-nums">{presentMetricShort("claim_rate", t.claim_rate, t.claim_rate_status)}</div>
                        </div>
                      </div>

                      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          指标周 {t.metric_iso_year != null && t.metric_iso_week != null
                            ? weekLabel(t.metric_iso_year, t.metric_iso_week)
                            : "暂无"}
                          {` · 任务周 ${weekLabel(t.iso_year, t.iso_week)}`}
                        </span>
                        <span className="flex items-center gap-1.5">
                          {t.owner ? (
                            <Badge className="bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-50 text-[10px] px-1.5 py-0 h-5" data-testid={`owner-badge-${t.sku}`}>
                              <UserPlus className="w-3 h-3 mr-0.5" />{t.owner}
                            </Badge>
                          ) : (
                            <Badge className="bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-100 text-[10px] px-1.5 py-0 h-5" data-testid={`owner-badge-${t.sku}`}>任务池</Badge>
                          )}
                          {t.due_date ? <span>截止 {t.due_date}</span> : null}
                        </span>
                      </div>
                    </button>

                    {/* Q3 状态切换按钮 —— 不包在卡片 button 内,避免嵌套 */}
                    <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-end gap-2 flex-wrap">
                      {/* v1.6 admin 专属: 指派下拉 */}
                      {isAdmin && curStatus !== "done" && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="outline" className="h-7 text-xs" data-testid={`btn-assign-${t.sku}`}>
                              <UserPlus className="w-3.5 h-3.5 mr-1" />
                              {t.owner ? `改派` : "指派"}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuLabel className="text-xs text-muted-foreground">
                              {t.owner ? `当前: ${t.owner}` : "指派给"}
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {operatorOptions.length === 0 && (
                              <div className="px-2 py-2 text-xs text-muted-foreground">暂无可指派的账号</div>
                            )}
                            {operatorOptions.map((u) => (
                              <DropdownMenuItem
                                key={u.username}
                                onClick={() => assignMut.mutate({ id: t.id, owner: u.username })}
                                className="cursor-pointer"
                                data-testid={`assign-to-${u.username}-${t.sku}`}
                              >
                                <span className="text-sm">{u.display_name}</span>
                                <span className="ml-2 text-[10px] text-muted-foreground">@{u.username}</span>
                              </DropdownMenuItem>
                            ))}
                            {t.owner && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => assignMut.mutate({ id: t.id, owner: null })}
                                  className="cursor-pointer text-muted-foreground"
                                  data-testid={`assign-release-${t.sku}`}
                                >
                                  释放回任务池
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      {curStatus === "open" && (
                        <>
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            disabled={isPending}
                            onClick={() => statusMut.mutate({ id: t.id, next: "in_progress" })}
                            data-testid={`btn-claim-${t.sku}`}
                          >
                            <PlayCircle className="w-3.5 h-3.5 mr-1" />接手
                          </Button>
                          <Button size="sm" className="h-7 text-xs"
                            disabled={isPending}
                            onClick={() => statusMut.mutate({ id: t.id, next: "done" })}
                            data-testid={`btn-done-${t.sku}`}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />直接完成
                          </Button>
                        </>
                      )}
                      {curStatus === "in_progress" && (
                        <>
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            disabled={isPending}
                            onClick={() => statusMut.mutate({ id: t.id, next: "open" })}
                            data-testid={`btn-release-${t.sku}`}
                          >
                            <RotateCcw className="w-3.5 h-3.5 mr-1" />释放
                          </Button>
                          <Button size="sm" className="h-7 text-xs"
                            disabled={isPending}
                            onClick={() => statusMut.mutate({ id: t.id, next: "done" })}
                            data-testid={`btn-done-${t.sku}`}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />完成
                          </Button>
                        </>
                      )}
                      {curStatus === "done" && (
                        <Button size="sm" variant="outline" className="h-7 text-xs"
                          disabled={isPending}
                          onClick={() => statusMut.mutate({ id: t.id, next: "open" })}
                          data-testid={`btn-reopen-${t.sku}`}
                        >
                          <RotateCcw className="w-3.5 h-3.5 mr-1" />重新打开
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
            })}
          </div>
        </div>

        <PaginationControls
          total={total}
          page={displayedPage}
          pageSize={displayedPageSize}
          loading={isFetching}
          onPageChange={setPage}
        />
      </div>

      {selSku && <SkuDetailDrawer sku={selSku} onClose={() => setSelSku(null)} />}

      {/* v1.7: 批量指派 Dialog(选人) */}
      <Dialog open={batchOwnerFor !== null} onOpenChange={(o) => { if (!o) setBatchOwnerFor(null); }}>
        <DialogContent className="max-w-md" data-testid="dialog-batch-assign">
          <DialogHeader>
            <DialogTitle>
              {batchOwnerFor === "selection" && `批量指派 · 选中 ${selectedIds.size} 项`}
              {batchOwnerFor === "category" && `按分类一键指派 · ${TASK_TYPE_META[taskType]?.zh || taskType}`}
              {batchOwnerFor === "paste" && "粘贴 SKU 列表批量指派"}
            </DialogTitle>
          </DialogHeader>

          {batchOwnerFor === "paste" && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">每行/逗号/空格分隔一个 SKU。只指派当前处于任务池的任务(已指派/已完成不变)。</div>
              <Textarea
                value={pasteSkuText}
                onChange={(e) => setPasteSkuText(e.target.value)}
                placeholder={"SKU001\nSKU002\nSKU003"}
                className="min-h-[140px] font-mono text-xs"
                data-testid="input-paste-skus"
              />
            </div>
          )}

          {batchOwnerFor === "category" && (
            <div className="text-xs text-muted-foreground py-2">
              将当前 Tab 分类 <b className="text-foreground">“{TASK_TYPE_META[taskType]?.zh || taskType}”</b> 下所有任务池 SKU 一键指派给指定运营。已指派、已完成的任务不变。
            </div>
          )}

          <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
            <div className="text-xs text-muted-foreground w-full">选择目标运营:</div>
            <div className="grid grid-cols-1 gap-1 w-full">
              {operatorOptions.length === 0 && (
                <div className="text-xs text-muted-foreground py-2">暂无可指派的账号</div>
              )}
              {operatorOptions.map((u) => (
                <button
                  key={u.username}
                  type="button"
                  onClick={() => doBatchAssign(u.username)}
                  disabled={batchAssignMut.isPending}
                  className="flex items-center justify-between rounded border border-border hover:border-primary hover:bg-muted/60 px-3 py-2 text-left disabled:opacity-50"
                  data-testid={`dialog-assign-to-${u.username}`}
                >
                  <span className="text-sm">{u.display_name}</span>
                  <span className="text-[10px] text-muted-foreground">@{u.username}</span>
                </button>
              ))}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
