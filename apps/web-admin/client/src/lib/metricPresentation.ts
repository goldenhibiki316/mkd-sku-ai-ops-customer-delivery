export type MetricKind = "gmv" | "margin" | "turnover" | "claim_rate";

export type MetricStatus =
  | "observed"
  | "no_sales"
  | "no_inventory"
  | "no_sales_velocity"
  | "no_effective_orders"
  | "source_partial"
  | "source_missing"
  | "missing_profit"
  | "missing_inventory"
  | "missing"
  | null
  | undefined;

type NumericValue = number | string | null | undefined;

const toFiniteNumber = (value: NumericValue): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export function presentMetric(kind: MetricKind, value: NumericValue, status: MetricStatus): string {
  if (status === "source_partial") return "当周数据未完整同步";
  if (status === "source_missing") return "源数据缺失";
  if (status === "no_sales" && kind === "margin") return "本周无销售";
  if (status === "no_inventory" && kind === "turnover") return "可用库存为0";
  if (status === "no_sales_velocity" && kind === "turnover") return "近30日无销量";
  if (status === "no_effective_orders" && kind === "claim_rate") return "本周无有效订单";
  if (status === "missing_profit" && kind === "margin") return "毛利依赖数据缺失";
  if (status === "missing_inventory" && kind === "turnover") return "库存数据缺失";

  const numeric = toFiniteNumber(value);
  if (numeric === null) return "源数据缺失";
  if (kind === "turnover" && numeric === 999 && status === "observed") {
    return "近 7 日无销量，周转暂无法估算";
  }

  switch (kind) {
    case "gmv":
      return `CLP ${numeric.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
    case "margin":
    case "claim_rate":
      return `${(numeric * 100).toFixed(2)}%`;
    case "turnover":
      return `${numeric.toLocaleString("zh-CN", { maximumFractionDigits: 0 })} 天`;
  }
}

export function presentPrice(value: NumericValue, source?: string | null): string {
  const numeric = toFiniteNumber(value);
  if (numeric === null || source === "missing") return "源数据缺失";
  return `CLP ${numeric.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
}
