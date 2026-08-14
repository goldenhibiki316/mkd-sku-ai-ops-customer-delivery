import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import type { AiAnalysisResponse, AiPageStatus } from "@shared/ai3a";

import { AiHistory } from "./AiHistory";
import {
  AiClientResponseError,
  getAiAnalysis,
  refreshAiAnalysis,
} from "./aiQueries";
import { AiSections } from "./AiSections";

const pageStatus: Record<
  AiPageStatus,
  { label: string; description: string; className: string }
> = {
  valid: {
    label: "分析有效",
    description: "当前内容已通过 AI 3A 完整性校验",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  incomplete: {
    label: "数据不完整",
    description: "当前分析可用，请结合缺失提醒进行复核",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  generation_failed: {
    label: "最近生成失败",
    description: "已继续展示最近可用分析，本次失败信息已记入生成记录",
    className: "border-rose-200 bg-rose-50 text-rose-700",
  },
  no_analysis: {
    label: "暂无有效分析",
    description: "固定栏目已就绪，点击刷新分析生成首条内容",
    className: "border-slate-200 bg-slate-50 text-slate-700",
  },
};

function formatTime(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? value
    : parsed.toLocaleString("zh-CN", { hour12: false });
}

export function AiAnalysisTab({ sku }: { sku: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const queryKey = ["sku-ai-analysis", sku];
  const analysisQuery = useQuery<AiAnalysisResponse>({
    queryKey,
    queryFn: ({ signal }) => getAiAnalysis(sku, signal),
    staleTime: 60_000,
  });
  const refresh = useMutation({
    mutationFn: () => refreshAiAnalysis(sku),
    onSuccess: (result) => {
      toast({
        title: result.status === "success" ? "AI 分析已刷新" : "分析请求已完成",
        description: result.model_name ? `模型：${result.model_name}` : "生成记录已更新",
      });
    },
    onError: (error) => {
      toast({
        title: "刷新失败",
        description:
          error instanceof AiClientResponseError
            ? error.message
            : "AI 分析服务暂时不可用，请稍后重试",
        variant: "destructive",
      });
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: ["sku-ai-history", sku] }),
      ]);
    },
  });

  if (analysisQuery.isLoading) {
    return (
      <Card className="p-4">
        <div className="inline-flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-primary" />
          AI 深度分析
        </div>
        <div className="mt-3 text-sm text-muted-foreground">AI 分析加载中…</div>
      </Card>
    );
  }

  if (analysisQuery.isError || !analysisQuery.data) {
    const errorMessage = analysisQuery.error instanceof AiClientResponseError
      ? analysisQuery.error.message
      : "AI 分析加载失败，请稍后重试";
    return (
      <Card className="p-4">
        <div className="inline-flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-primary" />
          AI 深度分析
        </div>
        <div className="mt-3 text-sm text-rose-700">{errorMessage}</div>
        <Button
          className="mt-3"
          size="sm"
          variant="outline"
          onClick={() => analysisQuery.refetch()}
          disabled={analysisQuery.isFetching}
        >
          {analysisQuery.isFetching ? "重试中" : "重试"}
        </Button>
      </Card>
    );
  }

  const analysis = analysisQuery.data;
  const status = pageStatus[analysis.analysis_status];
  const current = analysis.latest_valid_analysis;
  const generationInProgress =
    analysis.latest_generation_attempt?.analysis_status === "generating";
  const statusDescription =
    analysis.analysis_status === "generation_failed" && !current
      ? "最近生成失败，暂无可用分析；本次失败信息已记入生成记录"
      : status.description;

  return (
    <Card className="p-4" data-testid="ai-3a-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">AI 深度分析</span>
            <Badge variant="outline" className={status.className}>
              {status.label}
            </Badge>
            <Badge
              variant="outline"
              className={
                analysis.risk.color === "rose"
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : analysis.risk.color === "amber"
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : analysis.risk.color === "emerald"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-slate-50 text-slate-700"
              }
            >
              {analysis.risk.label_zh}
            </Badge>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {statusDescription}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>分析时间 {formatTime(current?.analysis_time)}</span>
            <span>模型 {current?.model_name ?? "未记录"}</span>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending || generationInProgress}
          data-testid="button-refresh-ai"
        >
          <RefreshCw
            className={`mr-1 h-3 w-3 ${refresh.isPending ? "animate-spin" : ""}`}
          />
          {refresh.isPending
            ? "刷新中"
            : generationInProgress
              ? "生成中"
              : "刷新分析"}
        </Button>
      </div>

      <div className="mt-5">
        <AiSections analysis={analysis} />
      </div>

      <div className="mt-5">
        <AiHistory sku={sku} />
      </div>
    </Card>
  );
}
