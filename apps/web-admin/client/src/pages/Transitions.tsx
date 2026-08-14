import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, getJSON } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import AsyncState from "@/components/AsyncState";
import PaginationControls from "@/components/PaginationControls";
import SkuDetailDrawer from "@/components/SkuDetailDrawer";
import { HelpCircle, ArrowRight, ImageOff, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { kindZh, weekLabel, isoWeekMonday, dateToIsoWeek } from "@/lib/dictionaries";
import { anchorDate } from "@/lib/anchor";
import { getTransitionOutOfRangeRecoveryPage } from "@/lib/transitionPageRecovery";

type Cell = {
  from_type_code: string | null;
  to_type_code: string | null;
  from_name: string | null;
  to_name: string | null;
  from_color: string | null;
  to_color: string | null;
  count: number;
};

type TransitionRow = {
  sku: string;
  product_name: string | null;
  image_url: string | null;
  primary_shop: string | null;
  from_iso_year: number;
  from_iso_week: number;
  from_type_code: string | null;
  from_name: string | null;
  from_color: string | null;
  to_iso_year: number;
  to_iso_week: number;
  to_type_code: string | null;
  to_name: string | null;
  to_color: string | null;
  transition_kind: string | null;
  primary_reason: string | null;
  detected_at: string;
};

type TransitionGroup = TransitionRow & {
  latest_detected_at: string;
  record_count: number;
};

type TransitionMatrixResponse = {
  matrix: Cell[];
  kinds: { transition_kind: string; count: number }[];
  weeks: { year: number; week: number; count: number }[];
};

type TransitionGroupPage = {
  groups: TransitionGroup[];
  total_skus: number;
  total_records: number;
  page: number;
  page_size: number;
  last_page: number;
  range_start: number;
  range_end: number;
};

type TransitionHistoryResponse = {
  transitions: TransitionRow[];
};

type TransitionRange = {
  startY: number;
  startW: number;
  endY: number;
  endW: number;
  kind: string | null;
};

const TRANSITION_PAGE_SIZE = 20;
const TRANSITION_KIND_OPTIONS = [
  "upgrade",
  "downgrade",
  "lateral",
  "lifecycle",
  "seasonal",
] as const;

const colorHex: Record<string, string> = {
  teal: "#14b8a6", emerald: "#10b981", amber: "#f59e0b", rose: "#f43f5e",
  slate: "#64748b", blue: "#3b82f6", orange: "#f97316", purple: "#a855f7", lime: "#84cc16",
};

// 默认最近 12 周(尊重数据锚定)
function defaultRange() {
  const now = anchorDate();
  const { year, week } = dateToIsoWeek(now.toISOString().slice(0, 10));
  const past = new Date(now.getTime() - 12 * 7 * 86400 * 1000);
  const start = dateToIsoWeek(past.toISOString().slice(0, 10));
  return { startY: start.year, startW: start.week, endY: year, endW: week };
}

export default function Transitions() {
  const init = defaultRange();
  const [startDate, setStartDate] = useState<string>(isoWeekMonday(init.startY, init.startW));
  const [endDate, setEndDate] = useState<string>(isoWeekMonday(init.endY, init.endW));
  const [kind, setKind] = useState("ALL");
  const [page, setPage] = useState(1);
  const [selSku, setSelSku] = useState<string | null>(null);
  const outOfRangeRecoveryUsedRef = useRef(false);

  useEffect(() => {
    setPage(1);
    outOfRangeRecoveryUsedRef.current = false;
  }, [startDate, endDate, kind]);

  const range = useMemo<TransitionRange>(() => {
    const start = dateToIsoWeek(startDate);
    const end = dateToIsoWeek(endDate);
    return {
      startY: start.year,
      startW: start.week,
      endY: end.year,
      endW: end.week,
      kind: kind === "ALL" ? null : kind,
    };
  }, [startDate, endDate, kind]);

  const { startY, startW, endY, endW } = range;
  const params = useMemo(() => {
    const search = new URLSearchParams({
      start_year: String(startY),
      start_week: String(startW),
      end_year: String(endY),
      end_week: String(endW),
    });
    if (range.kind) search.set("kind", range.kind);
    return search.toString();
  }, [endW, endY, range.kind, startW, startY]);

  const matrixQuery = useQuery<TransitionMatrixResponse, ApiError>({
    queryKey: ["transition-matrix", range],
    queryFn: ({ signal }) => getJSON<TransitionMatrixResponse>(
      `/api/transitions/matrix?${params}`,
      signal,
    ),
    staleTime: 60_000,
  });

  const groupsQuery = useQuery<TransitionGroupPage, ApiError>({
    queryKey: ["transition-groups", range, page],
    queryFn: ({ signal }) => getJSON<TransitionGroupPage>(
      `/api/transitions?${params}&page=${page}&page_size=20`,
      signal,
    ),
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });

  const lastGroupsDataRef = useRef<TransitionGroupPage | undefined>(undefined);
  useEffect(() => {
    if (groupsQuery.data) lastGroupsDataRef.current = groupsQuery.data;
  }, [groupsQuery.data]);
  const visibleGroupsData = groupsQuery.data ?? lastGroupsDataRef.current;
  const groups = visibleGroupsData?.groups ?? [];
  const groupsLocked = groupsQuery.isFetching || groupsQuery.isError;
  const showingPreviousGroups = Boolean(visibleGroupsData) && groupsLocked;

  useEffect(() => {
    if (!groupsQuery.isError || !(groupsQuery.error instanceof ApiError)) {
      return;
    }
    const recoveryPage = getTransitionOutOfRangeRecoveryPage(
      groupsQuery.error,
      outOfRangeRecoveryUsedRef.current,
    );
    if (recoveryPage === null) return;
    outOfRangeRecoveryUsedRef.current = true;
    setPage(recoveryPage);
  }, [groupsQuery.error, groupsQuery.isError]);

  const handleGroupsPageChange = (nextPage: number) => {
    outOfRangeRecoveryUsedRef.current = false;
    setPage(nextPage);
  };

  const handleGroupsRetry = () => {
    outOfRangeRecoveryUsedRef.current = false;
    void groupsQuery.refetch();
  };

  const cells = matrixQuery.data?.matrix ?? [];
  const kinds = matrixQuery.data?.kinds ?? [];

  // 构造桑基图数据
  const sankey = useMemo(() => {
    if (cells.length === 0) return { nodes: [], links: [], maxCount: 0 };
    const topCells = cells.slice(0, 15);
    const nodeMap = new Map<string, { key: string; name: string; color: string; side: "L" | "R" }>();
    topCells.forEach((c) => {
      const lKey = `L:${c.from_type_code}`;
      const rKey = `R:${c.to_type_code}`;
      if (!nodeMap.has(lKey)) nodeMap.set(lKey, { key: lKey, name: c.from_name || c.from_type_code || "-", color: colorHex[c.from_color || "slate"], side: "L" });
      if (!nodeMap.has(rKey)) nodeMap.set(rKey, { key: rKey, name: c.to_name || c.to_type_code || "-", color: colorHex[c.to_color || "slate"], side: "R" });
    });
    const links = topCells.map((c) => ({
      source: `L:${c.from_type_code}`,
      target: `R:${c.to_type_code}`,
      value: c.count,
      color: colorHex[c.from_color || "slate"],
      fromName: c.from_name,
      toName: c.to_name,
    }));
    const maxCount = Math.max(...topCells.map((c) => c.count), 1);
    return { nodes: Array.from(nodeMap.values()), links, maxCount };
  }, [cells]);

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold" data-testid="text-transitions-title">流转分析</h1>
        <p className="text-sm text-muted-foreground mt-1">
          SKU 分类在时间上的迁移轨迹,支持自由选择起止日期
        </p>
      </div>

      {/* 时间选择 */}
      <Card className="p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">起始日期</span>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-40 h-8 text-xs"
              data-testid="input-start-date"
            />
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground" />
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">结束日期</span>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-40 h-8 text-xs"
              data-testid="input-end-date"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">流转类型</span>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="h-8 w-36 text-xs" data-testid="select-transition-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部类型</SelectItem>
                {TRANSITION_KIND_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>{kindZh(option)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="text-muted-foreground hover:text-foreground" data-testid="help-date-range">
                <HelpCircle className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <div className="text-xs">
                系统按 ISO 周对齐:选择的日期会自动映射到所在的自然周。<br />
                默认展示最近 12 周的流转数据。
              </div>
            </TooltipContent>
          </Tooltip>
          <div className="text-xs text-muted-foreground ml-auto">
            当前范围:{weekLabel(startY, startW)} → {weekLabel(endY, endW)}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const r = defaultRange();
              setStartDate(isoWeekMonday(r.startY, r.startW));
              setEndDate(isoWeekMonday(r.endY, r.endW));
            }}
            data-testid="button-reset-range"
          >
            重置为最近 12 周
          </Button>
        </div>
      </Card>

      {matrixQuery.isLoading && !matrixQuery.data && (
        <AsyncState status="loading" message="正在加载流转统计" />
      )}
      {matrixQuery.isError && (
        <AsyncState
          status="error"
          message={formatApiError(matrixQuery.error, "流转统计加载失败，")}
          onRetry={() => { void matrixQuery.refetch(); }}
        />
      )}

      {/* 迁移类型统计 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {kinds.map((k) => (
          <Card key={k.transition_kind} className="p-4">
            <div className="text-xs text-muted-foreground">{kindZh(k.transition_kind)}</div>
            <div className="text-2xl font-semibold mt-1 tabular-nums" data-testid={`kind-count-${k.transition_kind}`}>{k.count}</div>
          </Card>
        ))}
      </div>

      {/* 桑基图 */}
      <div>
        <h2 className="text-base font-medium mb-3">Top 迁移对(桑基图)</h2>
        <Card className="p-6">
          {sankey.links.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">当前时间范围内暂无迁移数据</div>
          ) : (
            <SankeyChart nodes={sankey.nodes} links={sankey.links} maxCount={sankey.maxCount} />
          )}
        </Card>
      </div>

      {/* 明细列表 - 按 SKU 分组 */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-medium">
            最近流转明细
            <span className="text-xs text-muted-foreground font-normal ml-2">按 SKU 归组,同一 SKU 多次流转合并展示</span>
          </h2>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {showingPreviousGroups && (
              <Badge variant="outline" className="font-normal">上次成功数据，仅供参考</Badge>
            )}
            {visibleGroupsData ? (
              <span>共 {visibleGroupsData?.total_skus ?? 0} 个 SKU；{visibleGroupsData?.total_records ?? 0} 条流转记录</span>
            ) : (
              <span>流转数量待加载</span>
            )}
            {groupsQuery.isFetching && visibleGroupsData && (
              <Badge variant="outline" className="gap-1 font-normal">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                正在加载第 {page} 页
              </Badge>
            )}
          </div>
        </div>

        {groupsQuery.isLoading && !visibleGroupsData && (
          <AsyncState status="loading" message={`正在加载第 ${page} 页`} />
        )}
        {groupsQuery.isError && (
          <AsyncState
            status="error"
            message={formatApiError(groupsQuery.error, "流转明细加载失败，")}
            onRetry={handleGroupsRetry}
          />
        )}

        <fieldset
          disabled={groupsLocked}
          aria-busy={groupsQuery.isFetching}
          className="m-0 min-w-0 border-0 p-0"
        >
          <div className={`transition-opacity ${
            groupsLocked && visibleGroupsData ? "opacity-50 pointer-events-none" : "opacity-100"
          }`}>
            <TransitionsGrouped
              groups={groups}
              range={range}
              params={params}
              onSkuClick={setSelSku}
            />
            {!groupsQuery.isLoading && !groupsQuery.isError && groups.length === 0 && (
              <div className="text-sm text-muted-foreground p-4 text-center">当前时间范围内暂无流转记录</div>
            )}
          </div>
        </fieldset>

        <PaginationControls
          total={visibleGroupsData?.total_skus ?? 0}
          page={visibleGroupsData?.page ?? page}
          pageSize={TRANSITION_PAGE_SIZE}
          loading={groupsLocked}
          onPageChange={handleGroupsPageChange}
        />
      </div>

      {selSku && <SkuDetailDrawer sku={selSku} onClose={() => setSelSku(null)} />}
    </div>
  );
}

// ---- 手写 SVG 桑基图 ----
function SankeyChart({ nodes, links, maxCount }: { nodes: { key: string; name: string; color: string; side: "L" | "R" }[]; links: any[]; maxCount: number }) {
  const width = 900;
  const nodeWidth = 14;
  const leftX = 140; // 预留左侧标签区
  const rightX = width - 140 - nodeWidth; // 预留右侧标签区
  const gap = 8; // 同侧节点间距
  const topMargin = 32; // 顶部预留"迁移前分类/迁移后分类"小标题
  const bottomMargin = 12;

  const leftNodes = nodes.filter((n) => n.side === "L");
  const rightNodes = nodes.filter((n) => n.side === "R");

  const leftFlow: Record<string, number> = {};
  const rightFlow: Record<string, number> = {};
  links.forEach((l) => {
    leftFlow[l.source] = (leftFlow[l.source] || 0) + l.value;
    rightFlow[l.target] = (rightFlow[l.target] || 0) + l.value;
  });

  const totalLeft = Object.values(leftFlow).reduce((a, b) => a + b, 0);
  const totalRight = Object.values(rightFlow).reduce((a, b) => a + b, 0);

  // 先预估需要的高度:至少保证每个节点高度 >= 12 以容纳文字
  const nodeCountMax = Math.max(leftNodes.length, rightNodes.length);
  const minRowH = 22; // 每个节点至少 22px 以容纳标签
  const requiredHeight = topMargin + bottomMargin + nodeCountMax * minRowH + (nodeCountMax - 1) * gap;
  const height = Math.max(480, requiredHeight);
  const chartH = height - topMargin - bottomMargin;

  const scale = chartH / Math.max(totalLeft, totalRight, 1);

  // 节点位置
  const leftPos: Record<string, { y: number; h: number }> = {};
  let yL = topMargin;
  leftNodes.sort((a, b) => (leftFlow[b.key] || 0) - (leftFlow[a.key] || 0));
  leftNodes.forEach((n) => {
    const h = Math.max((leftFlow[n.key] || 0) * scale, minRowH);
    leftPos[n.key] = { y: yL, h };
    yL += h + gap;
  });

  const rightPos: Record<string, { y: number; h: number }> = {};
  let yR = topMargin;
  rightNodes.sort((a, b) => (rightFlow[b.key] || 0) - (rightFlow[a.key] || 0));
  rightNodes.forEach((n) => {
    const h = Math.max((rightFlow[n.key] || 0) * scale, minRowH);
    rightPos[n.key] = { y: yR, h };
    yR += h + gap;
  });

  // 实际总高:取左右两侧最大 yEnd
  const actualH = Math.max(yL, yR) + bottomMargin;

  // 计算每条 link 在源/目标节点内的偏移
  const linkPaths: any[] = [];
  const leftOffsets: Record<string, number> = {};
  const rightOffsets: Record<string, number> = {};
  links.sort((a, b) => b.value - a.value);
  links.forEach((l, i) => {
    const src = leftPos[l.source];
    const dst = rightPos[l.target];
    if (!src || !dst) return;
    const thickness = Math.max(l.value * scale, 1);
    const sy = src.y + (leftOffsets[l.source] || 0) + thickness / 2;
    const dy = dst.y + (rightOffsets[l.target] || 0) + thickness / 2;
    leftOffsets[l.source] = (leftOffsets[l.source] || 0) + thickness;
    rightOffsets[l.target] = (rightOffsets[l.target] || 0) + thickness;
    const x0 = leftX + nodeWidth;
    const x1 = rightX;
    const cx = (x0 + x1) / 2;
    const path = `M ${x0} ${sy} C ${cx} ${sy}, ${cx} ${dy}, ${x1} ${dy}`;
    linkPaths.push({ ...l, path, thickness, sy, dy });
  });

  return (
    <svg viewBox={`0 0 ${width} ${actualH}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet" data-testid="sankey-chart">
      {/* Links */}
      <g>
        {linkPaths.map((l, i) => (
          <g key={i}>
            <path
              d={l.path}
              stroke={l.color}
              strokeWidth={l.thickness}
              fill="none"
              opacity={0.35}
            >
              <title>{`${l.fromName} → ${l.toName}: ${l.value} 个 SKU`}</title>
            </path>
          </g>
        ))}
      </g>

      {/* Left nodes */}
      <g>
        {leftNodes.map((n) => {
          const p = leftPos[n.key];
          return (
            <g key={n.key}>
              <rect x={leftX} y={p.y} width={nodeWidth} height={p.h} fill={n.color} />
              <text x={leftX - 8} y={p.y + p.h / 2} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="currentColor">
                {n.name} <tspan opacity={0.6}>({leftFlow[n.key]})</tspan>
              </text>
            </g>
          );
        })}
      </g>

      {/* Right nodes */}
      <g>
        {rightNodes.map((n) => {
          const p = rightPos[n.key];
          return (
            <g key={n.key}>
              <rect x={rightX} y={p.y} width={nodeWidth} height={p.h} fill={n.color} />
              <text x={rightX + nodeWidth + 8} y={p.y + p.h / 2} textAnchor="start" dominantBaseline="middle" fontSize="11" fill="currentColor">
                {n.name} <tspan opacity={0.6}>({rightFlow[n.key]})</tspan>
              </text>
            </g>
          );
        })}
      </g>

      {/* Header */}
      <text x={leftX} y={18} fontSize="11" fill="currentColor" opacity={0.55} fontWeight={500}>迁移前分类</text>
      <text x={rightX + nodeWidth} y={18} fontSize="11" fill="currentColor" opacity={0.55} textAnchor="end" fontWeight={500}>迁移后分类</text>
    </svg>
  );
}

// ---- 按 SKU 分组的明细列表 ----
function TransitionsGrouped({
  groups,
  range,
  params,
  onSkuClick,
}: {
  groups: TransitionGroup[];
  range: TransitionRange;
  params: string;
  onSkuClick: (sku: string) => void;
}) {
  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <TransitionGroupCard
          key={group.sku}
          group={group}
          range={range}
          params={params}
          onSkuClick={onSkuClick}
        />
      ))}
    </div>
  );
}

function TransitionGroupCard({
  group,
  range,
  params,
  onSkuClick,
}: {
  group: TransitionGroup;
  range: TransitionRange;
  params: string;
  onSkuClick: (sku: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const historyQuery = useQuery<TransitionHistoryResponse, ApiError>({
    queryKey: ["transition-history", group.sku, range],
    queryFn: ({ signal }) => getJSON<TransitionHistoryResponse>(
      `/api/transitions/${encodeURIComponent(group.sku)}/history?${params}`,
      signal,
    ),
    enabled: expanded,
    staleTime: 60_000,
  });
  const history = historyQuery.data?.transitions ?? [];

  return (
    <Card className="overflow-hidden" data-testid={`transition-group-${group.sku}`}>
      <div className="p-3 flex gap-3 items-center hover:bg-muted/40 transition-colors">
        <button
          onClick={() => onSkuClick(group.sku)}
          className="flex gap-3 items-center flex-1 min-w-0 text-left"
          data-testid={`transition-header-${group.sku}`}
        >
          <div className="w-14 h-14 shrink-0 rounded-md bg-muted overflow-hidden flex items-center justify-center">
            {group.image_url ? (
              <img src={group.image_url} alt={group.product_name ?? group.sku} className="w-full h-full object-cover" />
            ) : (
              <ImageOff className="w-5 h-5 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium line-clamp-1">{group.product_name || `(未命名 ${group.sku})`}</div>
            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
              <span className="tabular-nums">SKU {group.sku}</span>
              {group.primary_shop && <span>· {group.primary_shop}</span>}
              <span>· 最近迁移 {group.detected_at?.slice(0, 10)}</span>
              <Badge variant="secondary" className="text-[10px] py-0 px-1.5">共 {group.record_count} 次迁移</Badge>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="outline" style={{ color: colorHex[group.from_color || "slate"], borderColor: colorHex[group.from_color || "slate"] }}>{group.from_name || group.from_type_code || "-"}</Badge>
            <ArrowRight className="w-4 h-4 text-muted-foreground" />
            <Badge variant="outline" style={{ color: colorHex[group.to_color || "slate"], borderColor: colorHex[group.to_color || "slate"] }}>{group.to_name || group.to_type_code || "-"}</Badge>
          </div>
          <div className="w-28 shrink-0 text-right">
            <div className="text-xs text-muted-foreground">{kindZh(group.transition_kind)}</div>
            <div className="text-xs text-muted-foreground line-clamp-2 mt-1">{group.primary_reason || "-"}</div>
          </div>
        </button>
        <button
          onClick={() => setExpanded((current) => !current)}
          className="shrink-0 p-1.5 rounded-md hover:bg-muted"
          data-testid={`transition-toggle-${group.sku}`}
          aria-label={expanded ? "收起" : "展开"}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </div>

      {expanded && (
        <div className="border-t bg-muted/20 px-3 py-2 space-y-1.5">
          <div className="text-[11px] text-muted-foreground font-medium mb-1">完整迁移轨迹(按时间倒序)</div>
          {historyQuery.isLoading && (
            <AsyncState status="loading" message="正在加载完整迁移轨迹" />
          )}
          {historyQuery.isError && (
            <AsyncState
              status="error"
              message={formatApiError(historyQuery.error, "完整迁移轨迹加载失败，")}
              onRetry={() => { void historyQuery.refetch(); }}
            />
          )}
          {!historyQuery.isLoading && !historyQuery.isError && history.length === 0 && (
            <div className="py-3 text-center text-xs text-muted-foreground">当前时间范围内暂无完整轨迹</div>
          )}
          {history.map((row, index) => (
            <div key={`${row.detected_at}-${index}`} className="flex items-center gap-3 text-xs py-1.5 px-2 rounded-md hover:bg-background/60" data-testid={`transition-item-${group.sku}-${index}`}>
              <span className="tabular-nums text-muted-foreground shrink-0 w-24">{row.detected_at?.slice(0, 10)}</span>
              <span className="tabular-nums text-muted-foreground shrink-0 w-14">W{row.from_iso_week ?? "-"}→W{row.to_iso_week ?? "-"}</span>
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <Badge variant="outline" className="text-[10px] py-0" style={{ color: colorHex[row.from_color || "slate"], borderColor: colorHex[row.from_color || "slate"] }}>{row.from_name || row.from_type_code || "-"}</Badge>
                <ArrowRight className="w-3 h-3 text-muted-foreground" />
                <Badge variant="outline" className="text-[10px] py-0" style={{ color: colorHex[row.to_color || "slate"], borderColor: colorHex[row.to_color || "slate"] }}>{row.to_name || row.to_type_code || "-"}</Badge>
              </div>
              <span className="text-muted-foreground shrink-0 w-16 text-right">{kindZh(row.transition_kind)}</span>
              <span className="text-muted-foreground line-clamp-1 shrink-0 w-48 text-right">{row.primary_reason || "-"}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function formatApiError(error: unknown, prefix: string) {
  if (!(error instanceof ApiError)) return `${prefix}请稍后重试。`;
  const requestId = error.request_id ? `（请求 ID：${error.request_id}）` : "";
  return `${prefix}${error.message}${requestId}`;
}
