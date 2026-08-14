import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { weekLabel } from "@/lib/dictionaries";
import type {
  AiDimension,
  AiHistoryResponse,
  AiPayload,
} from "@shared/ai3a";

type AnalysisHistoryItem = AiHistoryResponse["history"][number];
type TrendHistoryItem = AiHistoryResponse["trend_history"][number];
type EvidenceDimension = AiPayload["evidence"][AiDimension];

export const HISTORY_WEEK_RANGES = [4, 8, 12, 26] as const;
export type HistoryWeekRange = (typeof HISTORY_WEEK_RANGES)[number];

export type HistoryWeekGroup = {
  item: AnalysisHistoryItem;
  record_count: number;
};

export type HistoryWeekSlot = {
  key: string;
  iso_year: number;
  iso_week: number;
  group: HistoryWeekGroup | null;
};

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

const evidenceStateLabels: Record<EvidenceDimension["state"], string> = {
  complete: "依据完整",
  summary_only: "仅判断摘要",
  missing: "依据缺失",
  legacy_text: "旧版文本",
};

const riskColorClasses: Record<AnalysisHistoryItem["risk"]["color"], string> = {
  rose: "border-rose-200 bg-rose-50 text-rose-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  slate: "border-slate-200 bg-slate-50 text-slate-700",
};

function weekKey(isoYear: number, isoWeek: number) {
  return `${isoYear}-${isoWeek}`;
}

function isoWeekStart(isoYear: number, isoWeek: number) {
  const januaryFourth = new Date(Date.UTC(isoYear, 0, 4));
  const mondayOffset = (januaryFourth.getUTCDay() + 6) % 7;
  januaryFourth.setUTCDate(
    januaryFourth.getUTCDate() - mondayOffset + (isoWeek - 1) * 7,
  );
  return januaryFourth;
}

function dateToIsoWeek(value: Date) {
  const thursday = new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  ));
  const weekday = (thursday.getUTCDay() + 6) % 7;
  thursday.setUTCDate(thursday.getUTCDate() - weekday + 3);
  const isoYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstWeekday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstWeekday + 3);
  const isoWeek = 1 + Math.round(
    (thursday.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000),
  );
  return { iso_year: isoYear, iso_week: isoWeek };
}

function historyRecordCount(item: AnalysisHistoryItem) {
  const count = (item as Partial<TrendHistoryItem>).record_count;
  return typeof count === "number" ? count : 1;
}

export function groupLatestAnalysisByWeek(
  history: AnalysisHistoryItem[],
): HistoryWeekGroup[] {
  const groups = new Map<string, HistoryWeekGroup>();
  for (const item of history) {
    const key = weekKey(item.iso_year, item.iso_week);
    const current = groups.get(key);
    groups.set(key, {
      item: !current || item.analysis_time > current.item.analysis_time
        ? item
        : current.item,
      record_count:
        (current?.record_count ?? 0) +
        historyRecordCount(item),
    });
  }
  return Array.from(groups.values()).sort(
    (left, right) =>
      isoWeekStart(right.item.iso_year, right.item.iso_week).getTime() -
      isoWeekStart(left.item.iso_year, left.item.iso_week).getTime(),
  );
}

export function buildHistoryWeekSlots(
  history: AnalysisHistoryItem[],
  range: HistoryWeekRange,
): HistoryWeekSlot[] {
  const groups = groupLatestAnalysisByWeek(history);
  if (groups.length === 0) return [];
  const byWeek = new Map(
    groups.map((group) => [
      weekKey(group.item.iso_year, group.item.iso_week),
      group,
    ]),
  );
  const anchor = isoWeekStart(groups[0].item.iso_year, groups[0].item.iso_week);
  return Array.from({ length: range }, (_, index) => {
    const date = new Date(anchor);
    date.setUTCDate(anchor.getUTCDate() - index * 7);
    const { iso_year, iso_week } = dateToIsoWeek(date);
    const key = weekKey(iso_year, iso_week);
    return { key, iso_year, iso_week, group: byWeek.get(key) ?? null };
  });
}

export function defaultSelectedAnalysisIds(history: AnalysisHistoryItem[]) {
  return groupLatestAnalysisByWeek(history)
    .slice(0, 2)
    .map((group) => group.item.analysis_id);
}

export function toggleHistorySelection(
  selectedIds: string[],
  analysisId: string,
) {
  if (selectedIds.includes(analysisId)) {
    return selectedIds.length <= 2
      ? selectedIds
      : selectedIds.filter((id) => id !== analysisId);
  }
  return selectedIds.length >= 4
    ? selectedIds
    : [...selectedIds, analysisId];
}

export function canEnterHistoryCompare(selectedIds: string[]) {
  return selectedIds.length >= 2 && selectedIds.length <= 4;
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function HistoryEvidenceContent({
  value,
}: {
  value: EvidenceDimension;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] text-muted-foreground">
        {evidenceStateLabels[value.state]}
      </div>
      <div className="text-xs leading-relaxed">
        {value.summary ?? "判断摘要未返回"}
      </div>
      {value.evidence.map((item, index) => (
        <div
          key={`${item.metric ?? "evidence"}-${index}`}
          className="rounded border border-border/50 bg-background/70 p-1.5 text-[11px]"
        >
          <div>{item.metric ?? "指标未返回"}：{displayValue(item.value)}</div>
          <div className="text-muted-foreground">
            阈值 {displayValue(item.threshold)} · 判定 {item.verdict ?? "未返回"}
          </div>
        </div>
      ))}
    </div>
  );
}

type AiHistoryTrendProps = {
  history: TrendHistoryItem[];
  weekRange: HistoryWeekRange;
  onWeekRangeChange: (range: HistoryWeekRange) => void;
  selectedAnalysisIds: string[];
  onSelectedAnalysisIdsChange: (ids: string[]) => void;
  onOpenCompare: () => void;
};

export function AiHistoryTrend({
  history,
  weekRange,
  onWeekRangeChange,
  selectedAnalysisIds,
  onSelectedAnalysisIdsChange,
  onOpenCompare,
}: AiHistoryTrendProps) {
  const slots = buildHistoryWeekSlots(history, weekRange);
  const gridTemplateColumns = `7rem repeat(${slots.length}, minmax(12rem, 1fr))`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">范围</span>
          {HISTORY_WEEK_RANGES.map((range) => (
            <Button
              key={range}
              size="sm"
              variant={weekRange === range ? "default" : "outline"}
              onClick={() => onWeekRangeChange(range)}
            >
              {range} 周
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            已选择 {selectedAnalysisIds.length}/4 周
          </span>
          <Button
            size="sm"
            disabled={!canEnterHistoryCompare(selectedAnalysisIds)}
            onClick={onOpenCompare}
          >
            进入精细对比
          </Button>
        </div>
      </div>

      {slots.length === 0 ? (
        <div className="text-sm text-muted-foreground">暂无可用历史周</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/70">
          <div className="grid min-w-max" style={{ gridTemplateColumns }}>
            <div className="sticky left-0 z-10 border-b border-r bg-muted p-3 text-xs font-medium">
              周次
            </div>
            {slots.map((slot) => {
              const item = slot.group?.item;
              const selected = item
                ? selectedAnalysisIds.includes(item.analysis_id)
                : false;
              const selectionDisabled = item
                ? selected
                  ? selectedAnalysisIds.length <= 2
                  : selectedAnalysisIds.length >= 4
                : true;
              return (
                <div key={slot.key} className="border-b border-r p-3">
                  <div className="text-xs font-medium">
                    {weekLabel(slot.iso_year, slot.iso_week)}
                  </div>
                  {item ? (
                    <div className="mt-2 space-y-2">
                      <div className="text-[11px] text-muted-foreground">
                        同周 {slot.group?.record_count ?? 0} 条记录
                      </div>
                      <Button
                        size="sm"
                        variant={selected ? "default" : "outline"}
                        disabled={selectionDisabled}
                        aria-pressed={selected}
                        onClick={() =>
                          onSelectedAnalysisIdsChange(
                            toggleHistorySelection(
                              selectedAnalysisIds,
                              item.analysis_id,
                            ),
                          )
                        }
                      >
                        {selected ? "已选关键周" : "选择关键周"}
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-muted-foreground">
                      该周暂无分析
                    </div>
                  )}
                </div>
              );
            })}

            <div className="sticky left-0 z-10 border-b border-r bg-muted p-3 text-xs font-medium">
              风险时间带
            </div>
            {slots.map((slot) => (
              <div key={`risk-${slot.key}`} className="border-b border-r p-3 text-xs">
                {slot.group ? (
                  <Badge
                    variant="outline"
                    className={riskColorClasses[slot.group.item.risk.color]}
                  >
                    {slot.group.item.risk.label_zh}
                  </Badge>
                ) : "该周暂无分析"}
              </div>
            ))}

            <div className="sticky left-0 z-10 border-b border-r bg-muted p-3 text-xs font-medium">
              分类变化轨迹
            </div>
            {slots.map((slot) => (
              <div key={`classification-${slot.key}`} className="border-b border-r p-3 text-xs">
                {slot.group?.item.trend.classification ?? "该周暂无分析"}
              </div>
            ))}

            {dimensions.map((dimension) => [
              <div
                key={`${dimension}-label`}
                className="sticky left-0 z-10 border-b border-r bg-muted p-3 text-xs font-medium"
              >
                {dimensionLabels[dimension]}
              </div>,
              ...slots.map((slot) => (
                <div key={`${dimension}-${slot.key}`} className="border-b border-r p-3">
                  {slot.group ? (
                    <HistoryEvidenceContent
                      value={slot.group.item.trend.evidence[dimension]}
                    />
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      该周暂无分析
                    </div>
                  )}
                </div>
              )),
            ])}
          </div>
        </div>
      )}
    </div>
  );
}
