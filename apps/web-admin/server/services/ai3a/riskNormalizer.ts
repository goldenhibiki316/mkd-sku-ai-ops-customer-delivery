import type { NormalizedRisk } from "../../../shared/ai3a";

type RiskBase = Pick<NormalizedRisk, "level" | "label_zh" | "color">;

const levelAliases: Record<string, RiskBase> = {
  critical: { level: "high", label_zh: "高风险", color: "rose" },
  high: { level: "high", label_zh: "高风险", color: "rose" },
  "高": { level: "high", label_zh: "高风险", color: "rose" },
  "高风险": { level: "high", label_zh: "高风险", color: "rose" },
  medium: { level: "medium", label_zh: "中风险", color: "amber" },
  moderate: { level: "medium", label_zh: "中风险", color: "amber" },
  "中": { level: "medium", label_zh: "中风险", color: "amber" },
  "中风险": { level: "medium", label_zh: "中风险", color: "amber" },
  low: { level: "low", label_zh: "低风险", color: "emerald" },
  "低": { level: "low", label_zh: "低风险", color: "emerald" },
  "低风险": { level: "low", label_zh: "低风险", color: "emerald" },
};

const tagLabels: Record<string, string> = {
  sales_drop: "销量下滑",
  gmv_drop: "销量下滑",
  gmv_growth: "销量回升",
  zero_sales: "近 7 日无销量",
  ranking_loss: "排名下降",
  profit_drop: "利润下降",
  profit_low: "利润低",
  profit_high: "利润高",
  traffic_drop: "流量下滑",
  traffic_loss: "流量下滑",
  traffic_growth: "流量回升",
  inventory_risk: "库存风险",
  high_inventory: "库存积压",
  turnover_slow: "周转慢",
  turnover_fast: "周转快",
  stockout: "缺货风险",
  stockout_long: "长期缺货",
  claim_risk: "售后风险",
  high_claim: "高索赔",
  claim_high: "高赔付",
  claim_low: "赔付低",
  buybox_loss: "失去购买框",
  competition_pressure: "竞品压力",
  competitor_pressure: "竞品压力",
  ads_efficiency: "广告效率异常",
  inactive_listing: "商品未激活",
  data_invalid: "数据异常",
  data_incomplete: "数据不完整",
  mature_lifecycle: "成熟期",
  new_lifecycle: "新品期",
  decline_lifecycle: "衰退期",
  seasonal: "季节性",
  clearance: "清货",
};

const tagCodesByChineseLabel = Object.entries(tagLabels).reduce<
  Record<string, string>
>((codes, [code, label]) => {
  codes[label] ??= code;
  return codes;
}, {});

function normalizeRiskLevel(raw: string | null): RiskBase | undefined {
  if (!raw) return undefined;
  return levelAliases[raw.toLowerCase()] ?? levelAliases[raw];
}

export function normalizeRisk(rawLevel: unknown, rawTags: unknown) {
  const diagnostics: string[] = [];
  const raw =
    typeof rawLevel === "string" && rawLevel.trim()
      ? rawLevel.trim()
      : null;
  const base = normalizeRiskLevel(raw);

  if (raw && !base) {
    diagnostics.push(`unknown_risk_level:${raw}`);
  }

  const tagValues = Array.isArray(rawTags)
    ? rawTags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];
  const tags = tagValues.map((rawTag) => {
    const rawCode = rawTag.toLowerCase();
    const canonicalTag = tagLabels[rawCode]
      ? rawCode
      : tagCodesByChineseLabel[rawTag];
    const label = canonicalTag ? tagLabels[canonicalTag] : undefined;
    if (!label) {
      diagnostics.push(`unknown_risk_tag:${rawTag}`);
    }
    return {
      code: label ? canonicalTag : "unknown",
      label_zh: label ?? "风险标签待确认",
      raw_value: rawTag,
    };
  });

  const fallback: RiskBase = raw
    ? { level: "unknown", label_zh: "风险等级待确认", color: "slate" }
    : { level: "pending", label_zh: "风险等级待判定", color: "slate" };

  return {
    value: {
      ...(base ?? fallback),
      tags,
      raw_level: raw,
    } satisfies NormalizedRisk,
    diagnostics,
  };
}
