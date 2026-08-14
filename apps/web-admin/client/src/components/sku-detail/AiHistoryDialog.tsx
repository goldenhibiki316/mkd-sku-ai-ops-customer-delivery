import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { weekLabel } from "@/lib/dictionaries";
import type {
  AiHistoryDetailResponse,
  AiHistoryResponse,
} from "@shared/ai3a";

import { getAiHistoryDetail } from "./aiQueries";
import { AiSections } from "./AiSections";
import { AiHistoryCompare } from "./AiHistoryCompare";
import {
  AiHistoryTrend,
  defaultSelectedAnalysisIds,
  type HistoryWeekRange,
} from "./AiHistoryTrend";

type AnalysisHistoryItem = AiHistoryResponse["history"][number];
type TrendHistoryItem = AiHistoryResponse["trend_history"][number];

export type HistoryDialogMode = "detail" | "trend" | "compare";

export type AiHistoryDialogProps = {
  sku: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialAnalysisId: string | null;
  history: AnalysisHistoryItem[];
  trendHistory: TrendHistoryItem[];
};

export function AiHistoryDialog({
  sku,
  open,
  onOpenChange,
  initialAnalysisId,
  history,
  trendHistory,
}: AiHistoryDialogProps) {
  const [mode, setMode] = useState<HistoryDialogMode>("detail");
  const [weekRange, setWeekRange] = useState<HistoryWeekRange>(8);
  const [selectedAnalysisIds, setSelectedAnalysisIds] = useState<string[]>([]);
  const selectedItem = history.find(
    (item) => item.analysis_id === initialAnalysisId,
  );
  const comparisonHistory = trendHistory.length > 0 ? trendHistory : history;
  const effectiveSelectedIds = selectedAnalysisIds.length > 0
    ? selectedAnalysisIds
    : defaultSelectedAnalysisIds(comparisonHistory);
  const detailQuery = useQuery<AiHistoryDetailResponse>({
    queryKey: ["sku-ai-history-detail", sku, initialAnalysisId],
    enabled: open && Boolean(initialAnalysisId),
    queryFn: ({ signal }) =>
      getAiHistoryDetail(sku, initialAnalysisId ?? "", signal),
    staleTime: 5 * 60_000,
  });
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setMode("detail");
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="z-[70] max-h-[90vh] w-[95vw] max-w-[95vw] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-[95vw]">
        <DialogHeader className="border-b border-border/60 px-6 py-5 pr-12">
          <DialogTitle>历史分析</DialogTitle>
          <DialogDescription>
            {selectedItem
              ? `${weekLabel(selectedItem.iso_year, selectedItem.iso_week)} · ${selectedItem.model_name ?? "模型未记录"}`
              : "请选择一条历史分析记录"}
          </DialogDescription>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              size="sm"
              variant={mode === "detail" ? "default" : "outline"}
              onClick={() => setMode("detail")}
            >
              单条详情
            </Button>
            <Button
              size="sm"
              variant={mode === "trend" ? "default" : "outline"}
              onClick={() => setMode("trend")}
            >
              多周趋势概览
            </Button>
            <Button
              size="sm"
              variant={mode === "compare" ? "default" : "outline"}
              disabled={effectiveSelectedIds.length < 2}
              onClick={() => setMode("compare")}
            >
              关键周精细对比
            </Button>
          </div>
        </DialogHeader>

        <div
          className={mode === "detail"
            ? "min-h-0 overflow-y-auto px-6 py-5"
            : "hidden"}
        >
          {!initialAnalysisId ? (
            <div className="text-sm text-muted-foreground">
              请选择一条历史分析记录
            </div>
          ) : detailQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">
              正在加载完整内容…
            </div>
          ) : detailQuery.isError ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-rose-200 bg-rose-50/60 p-4 text-sm text-rose-700">
              <span>历史分析加载失败，请稍后重试</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void detailQuery.refetch();
                }}
              >
                重试
              </Button>
            </div>
          ) : detailQuery.data ? (
            <AiSections analysis={detailQuery.data.analysis} />
          ) : (
            <div className="text-sm text-muted-foreground">
              暂无历史分析详情
            </div>
          )}
        </div>

        <div
          className={mode === "trend"
            ? "min-h-0 overflow-y-auto px-6 py-5"
            : "hidden"}
        >
          <AiHistoryTrend
            history={trendHistory}
            weekRange={weekRange}
            onWeekRangeChange={setWeekRange}
            selectedAnalysisIds={effectiveSelectedIds}
            onSelectedAnalysisIdsChange={setSelectedAnalysisIds}
            onOpenCompare={() => setMode("compare")}
          />
        </div>

        <div
          className={mode === "compare"
            ? "min-h-0 overflow-y-auto px-6 py-5"
            : "hidden"}
        >
          <AiHistoryCompare
            sku={sku}
            history={comparisonHistory}
            selectedAnalysisIds={effectiveSelectedIds}
            enabled={open && mode === "compare"}
            onBackToTrend={() => setMode("trend")}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
