import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, History } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { weekLabel } from "@/lib/dictionaries";
import type {
  AiHistoryResponse,
  NormalizedRisk,
} from "@shared/ai3a";

import { getAiHistory } from "./aiQueries";
import { AiHistoryDialog } from "./AiHistoryDialog";

type AnalysisHistoryItem = AiHistoryResponse["history"][number];
type TrendHistoryItem = AiHistoryResponse["trend_history"][number];
type GenerationItem = AiHistoryResponse["generation_history"][number];

const storedStatusLabels: Record<GenerationItem["analysis_status"], string> = {
  generating: "生成中",
  valid: "分析有效",
  incomplete: "数据不完整",
  no_api_key: "服务配置缺失",
  model_failed: "模型服务失败",
  schema_invalid: "内容结构异常",
  server_failed: "服务处理失败",
};

const safeErrorLabels: Record<string, string> = {
  AI_API_KEY_MISSING: "服务配置缺失",
  AI_SCHEMA_INVALID: "内容结构异常",
  AI_SERVER_FAILED: "服务处理失败",
  AI_MODEL_REQUEST_ERROR: "模型请求失败",
  AI_MODEL_NETWORK_ERROR: "模型网络异常",
  AI_MODEL_TIMEOUT: "模型请求超时",
  AI_MODEL_RESPONSE_READ_ERROR: "模型响应读取异常",
  AI_MODEL_HTTP_401: "模型服务鉴权失败",
  AI_MODEL_HTTP_429: "模型服务繁忙",
  AI_MODEL_HTTP_5XX: "模型服务异常",
  AI_MODEL_HTTP_ERROR: "模型请求异常",
  GENERATION_STALE: "生成任务超时",
};

const safeDiagnosticSummaries: Record<GenerationItem["analysis_status"], string> = {
  generating: "分析正在生成",
  valid: "本次分析已成功生成",
  incomplete: "本次分析已生成，部分数据或栏目缺失",
  no_api_key: "AI 服务配置缺失，请联系管理员",
  model_failed: "模型服务暂时不可用",
  schema_invalid: "本次生成内容结构不完整",
  server_failed: "AI 分析服务暂时不可用",
};

function formatTime(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? value
    : parsed.toLocaleString("zh-CN", { hour12: false });
}

function formatCost(value: number | null | undefined) {
  return value === null || value === undefined
    ? "—"
    : `$${value.toFixed(6)} USD`;
}

function riskBadge(risk: NormalizedRisk) {
  const color =
    risk.color === "rose"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : risk.color === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : risk.color === "emerald"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <Badge variant="outline" className={color}>
      {risk.label_zh}
    </Badge>
  );
}

function HistoryList({
  sku,
  history,
  trendHistory,
  loaded,
  open,
  onOpenChange,
  isLoading,
  isError,
  onRetry,
}: {
  sku: string;
  history: AnalysisHistoryItem[];
  trendHistory: TrendHistoryItem[];
  loaded: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const orderedHistory = useMemo(
    () =>
      history
        .filter((item) => ["valid", "incomplete"].includes(item.analysis_status))
        .sort((left, right) => {
          if (left.current !== right.current) return left.current ? -1 : 1;
          return right.analysis_time.localeCompare(left.analysis_time);
        }),
    [history],
  );

  return (
    <>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md border border-border/60 px-3 py-2 text-left text-sm font-medium hover:bg-muted/40">
          <span className="inline-flex items-center gap-2">
            <History className="h-4 w-4" />
            历史分析 ({loaded ? orderedHistory.length : "待加载"})
          </span>
          <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          {isLoading ? (
            <div className="text-sm text-muted-foreground">历史分析加载中…</div>
          ) : isError ? (
            <div className="flex items-center justify-between gap-3 text-sm text-rose-700">
              <span>历史分析加载失败</span>
              <Button size="sm" variant="outline" onClick={onRetry}>重试</Button>
            </div>
          ) : orderedHistory.length > 0 ? (
            <div className="space-y-2">
              {orderedHistory.map((item) => (
                <button
                  key={item.analysis_id}
                  type="button"
                  aria-haspopup="dialog"
                  onClick={() => {
                    setSelectedId(item.analysis_id);
                    setDialogOpen(true);
                  }}
                  className="w-full rounded-md border border-border/60 p-3 text-left hover:border-primary/40 hover:bg-muted/20"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">
                      {item.analysis_status === "valid" ? "分析有效" : "数据不完整"}
                    </Badge>
                    {item.current && <Badge>当前展示</Badge>}
                    {riskBadge(item.risk)}
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                    <span>{formatTime(item.analysis_time)}</span>
                    <span>模型 {item.model_name ?? "未记录"}</span>
                    <span>{weekLabel(item.iso_year, item.iso_week)}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">暂无历史分析</div>
          )}
        </CollapsibleContent>
      </Collapsible>

      <AiHistoryDialog
        sku={sku}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialAnalysisId={selectedId}
        history={orderedHistory}
        trendHistory={trendHistory}
      />
    </>
  );
}

function GenerationHistory({
  history,
  loaded,
  open,
  onOpenChange,
  isLoading,
  isError,
  onRetry,
}: {
  history: GenerationItem[];
  loaded: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md border border-border/60 px-3 py-2 text-left text-sm font-medium hover:bg-muted/40">
        <span>生成记录 ({loaded ? history.length : "待加载"})</span>
        <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">生成记录加载中…</div>
        ) : isError ? (
          <div className="flex items-center justify-between gap-3 text-sm text-rose-700">
            <span>生成记录加载失败</span>
            <Button size="sm" variant="outline" onClick={onRetry}>重试</Button>
          </div>
        ) : history.length > 0 ? (
          <div className="space-y-3">
            {history.map((item) => (
              <div
                key={item.analysis_id}
                className="rounded-md border border-border/60 bg-muted/20 p-3"
              >
                <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                  <div><span className="text-muted-foreground">开始时间：</span>{formatTime(item.started_at)}</div>
                  <div><span className="text-muted-foreground">结束时间：</span>{formatTime(item.finished_at)}</div>
                  <div><span className="text-muted-foreground">模型：</span>{item.model_name ?? "未记录"}</div>
                  <div><span className="text-muted-foreground">状态：</span>{storedStatusLabels[item.analysis_status]}</div>
                  <div><span className="text-muted-foreground">错误分类：</span>{item.error_code ? safeErrorLabels[item.error_code] ?? "其他失败" : "—"}</div>
                  <div><span className="text-muted-foreground">Token：</span>{item.token_used ?? "—"}</div>
                  <div><span className="text-muted-foreground">成本：</span>{formatCost(item.cost_usd)}</div>
                </div>
                <div className="mt-2 text-xs text-amber-800">
                  诊断摘要：{safeDiagnosticSummaries[item.analysis_status]}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">暂无生成记录</div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function AiHistory({ sku }: { sku: string }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [generationOpen, setGenerationOpen] = useState(false);
  const historyQuery = useQuery({
    queryKey: ["sku-ai-history", sku],
    enabled: historyOpen || generationOpen,
    queryFn: ({ signal }) => getAiHistory(sku, signal),
    staleTime: 5 * 60_000,
  });
  const historyLoaded = historyQuery.data !== undefined;
  const retry = () => {
    void historyQuery.refetch();
  };

  return (
    <div className="space-y-3">
      <HistoryList
        sku={sku}
        history={historyQuery.data?.history ?? []}
        trendHistory={historyQuery.data?.trend_history ?? []}
        loaded={historyLoaded}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        isLoading={historyQuery.isLoading}
        isError={historyQuery.isError}
        onRetry={retry}
      />
      <GenerationHistory
        history={historyQuery.data?.generation_history ?? []}
        loaded={historyLoaded}
        open={generationOpen}
        onOpenChange={setGenerationOpen}
        isLoading={historyQuery.isLoading}
        isError={historyQuery.isError}
        onRetry={retry}
      />
    </div>
  );
}
