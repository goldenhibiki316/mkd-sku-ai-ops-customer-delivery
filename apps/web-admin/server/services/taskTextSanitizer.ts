import { normalizeRisk } from "./ai3a/riskNormalizer";

function localizeLeadingRisk(value: string): string {
  return value.replace(
    /^(?:\s*\[[A-Z][A-Z_-]*\]\s*)+/i,
    (prefix) => {
      const labels = Array.from(
        prefix.matchAll(/\[([A-Z][A-Z_-]*)\]/gi),
        (match) => `[${normalizeRisk(match[1], []).value.label_zh}]`,
      );
      return `${labels.join(" ")} `;
    },
  );
}

export function sanitizeTaskText(
  raw: string | null | undefined,
  typeLabels: Record<string, string>,
): string {
  if (!raw) return "";
  let value = String(raw);
  value = value.replace(/\b\d{10,}\b/g, "").trim();
  value = localizeLeadingRisk(value).trim();
  value = value.replace(
    /\b([RS]_[A-Z_]+)\b/g,
    (_, code: string) => typeLabels[code] || code,
  );
  value = value.replace(/,?\s*[a-z_]+=[\w.\-]+/gi, "");
  value = value.replace(/\bstockout_long\b/gi, "长期缺货");
  value = value
    .replace(/\bWoW\b/g, "周环比")
    .replace(/\bMoM\b/g, "月环比")
    .replace(/\bYoY\b/g, "同比");
  value = value
    .replace(/\bACOS\b/gi, "广告花费占比")
    .replace(/\bBuybox\b/gi, "购买框");
  value = value.replace(/\s*\(\s*\)\s*/g, " ");
  return value.replace(/\s{2,}/g, " ").trim();
}
