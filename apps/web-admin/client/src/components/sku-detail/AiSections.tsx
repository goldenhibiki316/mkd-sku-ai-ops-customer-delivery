import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { polishAiText } from "@/lib/dictionaries";
import type { AiAction, AiDimension, AiPayload } from "@shared/ai3a";

const dimensionLabels: Record<AiDimension, string> = {
  sales: "销售",
  profit: "利润",
  traffic: "流量",
  inventory: "库存",
  aftersales: "售后",
  competition: "竞品商品箱",
  lifecycle: "生命周期",
};

const dimensions = Object.keys(dimensionLabels) as AiDimension[];

const actionTypeLabels: Record<string, string> = {
  price_adjust: "价格",
  ads_adjust: "推广",
  promotion_manage: "促销",
  purchase_restock: "采购补货",
  full_restock: "Full 补仓",
  listing_optimize: "链接优化",
  review: "周复盘",
};

const incompleteBadge = (
  <Badge
    variant="outline"
    className="border-amber-200 bg-amber-50 text-amber-700"
  >
    数据不完整
  </Badge>
);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2" data-testid={`ai-section-${title}`}>
      <h4 className="text-sm font-medium">{title}</h4>
      {children}
    </section>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span>{text}</span>
      {incompleteBadge}
    </div>
  );
}

function textValue(value: unknown, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return polishAiText(String(value)) || fallback;
}

function verdictColor(verdict: string | null) {
  const value = verdict ?? "";
  if (["预警", "高", "偏高", "危险", "严重"].some((item) => value.includes(item))) {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (["健康", "优", "强", "正常"].some((item) => value.includes(item))) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (["偏低", "低", "关注"].some((item) => value.includes(item))) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function EvidenceCard({
  label,
  value,
}: {
  label: string;
  value: AiPayload["evidence"][AiDimension];
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="text-xs font-medium">{label}</div>
      {value.summary ? (
        <div className="mt-1 text-sm leading-relaxed">
          {polishAiText(value.summary)}
        </div>
      ) : value.evidence.length > 0 ? (
        <div className="mt-1">
          <EmptyLine text="结论未返回" />
        </div>
      ) : (
        <div className="mt-1">
          <EmptyLine text="暂无判断依据" />
        </div>
      )}

      {value.evidence.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {value.evidence.map((item, index) => (
            <div
              key={`${item.metric ?? "evidence"}-${index}`}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
            >
              <span className="text-muted-foreground">
                {textValue(item.metric, "指标未返回")}
              </span>
              <span className="font-medium tabular-nums">
                {textValue(item.value)}
              </span>
              <span className="text-muted-foreground">
                阈值 {textValue(item.threshold)}
              </span>
              {item.verdict && (
                <Badge
                  variant="outline"
                  className={`h-5 px-1.5 text-[10px] ${verdictColor(item.verdict)}`}
                >
                  {polishAiText(item.verdict)}
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}

      {value.state === "summary_only" && (
        <div className="mt-2 text-xs text-amber-700">依据未返回</div>
      )}
      {value.state === "legacy_text" && (
        <div className="mt-2 text-xs text-muted-foreground">
          旧版记录·依据未结构化
        </div>
      )}
    </div>
  );
}

function actionFallback(action: AiAction) {
  return action.source === "next_week_actions"
    ? "旧版记录·字段未结构化"
    : "未返回";
}

function ActionCard({ action, index }: { action: AiAction; index: number }) {
  const fallback = actionFallback(action);
  const type = action.task_type
    ? actionTypeLabels[action.task_type] ?? polishAiText(action.task_type)
    : fallback;

  return (
    <article
      className="rounded-lg border border-orange-200 bg-background p-4"
      data-testid={`ai-action-${index}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-100 text-sm font-semibold text-orange-700">
            {index + 1}
          </span>
          <Badge variant="outline">{type}</Badge>
          <h5 className="font-medium">{textValue(action.title, fallback)}</h5>
        </div>
        <div className="text-xs text-muted-foreground">
          负责人：{textValue(action.owner, "待分配")}　优先级：
          {action.priority ? `P${action.priority}` : "待确认"}
        </div>
      </header>
      <div className="mt-3 border-l-2 border-orange-300 pl-3 text-sm">
        <span className="text-muted-foreground">具体动作：</span>
        {textValue(action.specific_change, fallback)}
      </div>
      <div className="mt-3 text-sm">
        <span className="text-muted-foreground">原因：</span>
        {textValue(action.reason, fallback)}
      </div>
      <div className="mt-3 rounded-md bg-muted/40 px-3 py-2 text-xs">
        <span className="text-muted-foreground">约束：</span>
        {textValue(action.guardrail, fallback)}
      </div>
    </article>
  );
}

function MissingInputs({ value }: { value: AiPayload["missing_inputs"] }) {
  if (value.state === "reported") {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3">
        <div className="mb-2">{incompleteBadge}</div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900">
          {value.items.map((item, index) => (
            <li key={`${item}-${index}`}>{polishAiText(item)}</li>
          ))}
        </ul>
      </div>
    );
  }
  if (value.state === "none_reported") {
    return (
      <div className="text-sm text-muted-foreground">
        本次分析未报告关键数据缺口
      </div>
    );
  }
  if (value.state === "legacy_unavailable") {
    return (
      <div className="text-sm text-muted-foreground">
        旧版记录·缺失项未结构化
      </div>
    );
  }
  return <EmptyLine text="缺失情况未返回" />;
}

export function AiSections({ analysis }: { analysis: AiPayload }) {
  return (
    <div className="space-y-5">
      <Section title="SOP V3 分类判定">
        <div className="space-y-3 rounded-md border border-primary/20 bg-primary/5 p-3">
          <div>
            <div className="mb-1 text-xs text-muted-foreground">分类结果</div>
            {analysis.classification.value ? (
              <Badge>{polishAiText(analysis.classification.value)}</Badge>
            ) : (
              <EmptyLine text="暂无分类判定" />
            )}
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">触发原因</div>
            {analysis.classification.trigger_reasons.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                {analysis.classification.trigger_reasons.map((reason, index) => (
                  <Badge key={`${reason}-${index}`} variant="outline">
                    {polishAiText(reason)}
                  </Badge>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">暂无触发原因</div>
            )}
          </div>
          {analysis.classification.value &&
            analysis.classification.state !== "available" && (
              <div>{incompleteBadge}</div>
            )}
        </div>
      </Section>

      <Section title="一句话结论">
        {analysis.conclusion.text ? (
          <div className="text-sm font-medium leading-relaxed">
            {polishAiText(analysis.conclusion.text)}
          </div>
        ) : (
          <EmptyLine text="暂无结论" />
        )}
      </Section>

      <Section title="风险">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
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
            {analysis.risk.tags.length > 0 ? (
              analysis.risk.tags.map((tag, index) => (
                <Badge key={`${tag.raw_value}-${index}`} variant="outline">
                  {tag.label_zh}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">暂无风险标签</span>
            )}
          </div>
          {(analysis.risk.level === "pending" ||
            analysis.risk.level === "unknown" ||
            (analysis.risk.tags.length === 0 &&
              ["high", "medium"].includes(analysis.risk.level))) && (
            <div>{incompleteBadge}</div>
          )}
        </div>
      </Section>

      <Section title="判断依据/七维诊断（实际数据 vs SOP V3 阈值）">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {dimensions.map((key) => (
            <EvidenceCard
              key={key}
              label={dimensionLabels[key]}
              value={analysis.evidence[key]}
            />
          ))}
        </div>
      </Section>

      <Section title="本周执行建议">
        {analysis.actions.length > 0 ? (
          <div className="space-y-3">
            {analysis.actions.map((action, index) => (
              <ActionCard key={`${action.title ?? "action"}-${index}`} action={action} index={index} />
            ))}
          </div>
        ) : (
          <EmptyLine text="暂无行动建议" />
        )}
      </Section>

      <Section title="数据缺失提醒">
        <MissingInputs value={analysis.missing_inputs} />
      </Section>
    </div>
  );
}
