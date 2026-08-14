import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { polishAiText, weekLabel } from "@/lib/dictionaries";
import type {
  AiAction,
  AiDimension,
  AiHistoryDetailResponse,
  AiHistoryResponse,
} from "@shared/ai3a";

import { getAiHistoryDetail } from "./aiQueries";
import { HistoryEvidenceContent } from "./AiHistoryTrend";

type AnalysisHistoryItem = AiHistoryResponse["history"][number];

const dimensions: AiDimension[] = [
  "sales",
  "profit",
  "traffic",
  "inventory",
  "aftersales",
  "competition",
  "lifecycle",
];

const dimensionLabels: Record<AiDimension, string> = {
  sales: "销售",
  profit: "利润",
  traffic: "流量",
  inventory: "库存",
  aftersales: "售后",
  competition: "竞品商品箱",
  lifecycle: "生命周期",
};

function textValue(value: unknown, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return polishAiText(String(value)) || fallback;
}

function actionFallback(action: AiAction) {
  return action.source === "next_week_actions"
    ? "旧版记录·字段未结构化"
    : "未返回";
}

function HistoryCompareColumn({
  sku,
  item,
  enabled,
}: {
  sku: string;
  item: AnalysisHistoryItem;
  enabled: boolean;
}) {
  const detailQuery = useQuery<AiHistoryDetailResponse>({
    queryKey: ["sku-ai-history-detail", sku, item.analysis_id],
    enabled: enabled && Boolean(item),
    queryFn: ({ signal }) => getAiHistoryDetail(sku, item.analysis_id, signal),
    staleTime: 5 * 60_000,
  });

  if (detailQuery.isLoading) {
    return (
      <div className="row-span-6 w-[20rem] rounded-lg border p-4 text-sm text-muted-foreground">
        正在加载 {weekLabel(item.iso_year, item.iso_week)}…
      </div>
    );
  }
  if (detailQuery.isError) {
    return (
      <div className="row-span-6 w-[20rem] rounded-lg border border-rose-200 bg-rose-50/60 p-4 text-sm text-rose-700">
        <div>该周详情加载失败</div>
        <Button
          className="mt-3"
          size="sm"
          variant="outline"
          onClick={() => {
            void detailQuery.refetch();
          }}
        >
          重试
        </Button>
      </div>
    );
  }
  if (!detailQuery.data) {
    return (
      <div className="row-span-6 w-[20rem] rounded-lg border p-4 text-sm text-muted-foreground">
        该周详情待加载
      </div>
    );
  }

  const analysis = detailQuery.data.analysis;
  return (
    <article className="row-span-6 grid w-[20rem] grid-rows-subgrid rounded-lg border border-border/70 bg-background p-4">
      <section>
        <h4 className="text-xs text-muted-foreground">周次/状态</h4>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-medium">
          <span>{weekLabel(item.iso_year, item.iso_week)}</span>
          <Badge variant="outline">
            {item.analysis_status === "valid" ? "分析有效" : "数据不完整"}
          </Badge>
        </div>
      </section>
      <section>
        <h4 className="text-xs text-muted-foreground">分类判定</h4>
        <div className="mt-1 text-sm">
          {analysis.classification.value ?? "分类未返回"}
        </div>
      </section>
      <section>
        <h4 className="text-xs text-muted-foreground">风险</h4>
        <div className="mt-1 text-sm">{analysis.risk.label_zh}</div>
      </section>
      <section>
        <h4 className="text-xs text-muted-foreground">一句话结论</h4>
        <div className="mt-1 text-sm leading-relaxed">
          {analysis.conclusion.text ?? "结论未返回"}
        </div>
      </section>
      <section>
        <h4 className="text-xs text-muted-foreground">七维依据</h4>
        <div className="mt-2 space-y-3">
          {dimensions.map((dimension) => (
            <div key={dimension} className="rounded-md bg-muted/30 p-2">
              <div className="mb-1 text-xs font-medium">
                {dimensionLabels[dimension]}
              </div>
              <HistoryEvidenceContent value={analysis.evidence[dimension]} />
            </div>
          ))}
        </div>
      </section>
      <section>
        <h4 className="text-xs text-muted-foreground">本周执行建议</h4>
        <div className="mt-2 space-y-2">
          {analysis.actions.length > 0 ? analysis.actions.map((action, index) => {
            const fallback = actionFallback(action);
            return (
              <div key={`${action.title ?? "action"}-${index}`} className="rounded-md bg-muted/30 p-2 text-xs">
                <div className="font-medium">
                  {textValue(action.title, fallback)}
                </div>
                <div className="mt-1">
                  <span className="text-muted-foreground">具体动作：</span>
                  {textValue(action.specific_change, fallback)}
                </div>
                <div className="mt-1">
                  <span className="text-muted-foreground">原因：</span>
                  {textValue(action.reason, fallback)}
                </div>
                <div className="mt-1 text-muted-foreground">
                  负责人：{textValue(action.owner, "待分配")} · 优先级：{action.priority ? `P${action.priority}` : "待确认"}
                </div>
                <div className="mt-1 rounded bg-background/70 px-2 py-1">
                  <span className="text-muted-foreground">约束：</span>
                  {textValue(action.guardrail, fallback)}
                </div>
              </div>
            );
          }) : (
            <div className="text-xs text-muted-foreground">暂无行动建议</div>
          )}
        </div>
      </section>
    </article>
  );
}

type AiHistoryCompareProps = {
  sku: string;
  history: AnalysisHistoryItem[];
  selectedAnalysisIds: string[];
  enabled: boolean;
  onBackToTrend: () => void;
};

export function AiHistoryCompare({
  sku,
  history,
  selectedAnalysisIds,
  enabled,
  onBackToTrend,
}: AiHistoryCompareProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          已选择 {selectedAnalysisIds.length} 周
        </div>
        <Button size="sm" variant="outline" onClick={onBackToTrend}>
          返回趋势
        </Button>
      </div>
      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-max grid-flow-col auto-cols-[20rem] grid-rows-[repeat(6,auto)] gap-x-4 gap-y-4">
          {selectedAnalysisIds.map((analysisId) => {
            const item = history.find(
              (historyItem) => historyItem.analysis_id === analysisId,
            );
            return item ? (
              <HistoryCompareColumn
                key={analysisId}
                sku={sku}
                item={item}
                enabled={enabled}
              />
            ) : (
              <div key={analysisId} className="row-span-6 w-[20rem] rounded-lg border p-4 text-sm text-muted-foreground">
                历史记录不存在
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
