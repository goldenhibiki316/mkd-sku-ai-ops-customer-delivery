// 数据锚定:让整个后端把"今天"当成一个可配置的过去日期。
// 触发场景:上游数据管道断点,前端展示大面积"——",通过锚定绕开。
// 关闭方法:.env 里不设 DATA_ANCHOR_DATE(或设为空)即恢复真实"今天"。

const RAW = process.env.DATA_ANCHOR_DATE?.trim();
const ANCHOR = RAW && /^\d{4}-\d{2}-\d{2}$/.test(RAW) ? RAW : null;

if (ANCHOR) {
  // 部署时打一条日志,便于运维辨识实例
  // eslint-disable-next-line no-console
  console.log(`[anchor] DATA_ANCHOR_DATE=${ANCHOR} — 后端时间锚定已启用`);
}

/** 是否启用了数据锚定。 */
export const isAnchored = () => ANCHOR !== null;

/** 锚定的"今天"(YYYY-MM-DD)。未启用时返回真实今天。 */
export const anchorDate = (): string => {
  if (ANCHOR) return ANCHOR;
  return new Date().toISOString().slice(0, 10);
};

/**
 * 用于 SQL 里替换 CURRENT_DATE 的字面量。
 * 用法:  `... WHERE data_date > (${anchorSqlDate()} - INTERVAL '30 days')`
 * 未启用时返回 'CURRENT_DATE',启用时返回 "DATE '2026-06-13'"。
 */
export const anchorSqlDate = (): string => {
  return ANCHOR ? `DATE '${ANCHOR}'` : "CURRENT_DATE";
};

/**
 * 用于 SQL 里替换 NOW() 的字面量(仅用于业务时间查询,审计时间戳不要用!)。
 * 未启用时返回 'NOW()',启用时返回锚定日 23:59:59。
 */
export const anchorSqlTimestamp = (): string => {
  return ANCHOR ? `TIMESTAMP '${ANCHOR} 23:59:59'` : "NOW()";
};

/**
 * 锚定日归属的 ISO 年/周。
 * 2026-06-13 (周六) 归属 iso_year=2026, iso_week=24。
 */
export const anchorIsoWeek = (): { isoYear: number; isoWeek: number } => {
  const d = new Date(anchorDate() + "T00:00:00Z");
  const target = new Date(d);
  const dayNr = (d.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const isoYear = target.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const isoWeek =
    1 + Math.round(((target.getTime() - yearStart.getTime()) / 86400000 - 3 + ((yearStart.getUTCDay() + 6) % 7)) / 7);
  return { isoYear, isoWeek };
};

/**
 * SQL WHERE 片段:限制 iso_year/iso_week 不超过锚定周。
 * 未启用时返回空字符串(SQL 恢复原行为)。
 * 启用时返回形如 " AND (iso_year * 100 + iso_week) <= 202624" 的片段，
 * 同时支持为字段加前缀（如 "t."）。
 */
export const anchorIsoWeekLimit = (
  prefix: string = "",
  yearCol: string = "iso_year",
  weekCol: string = "iso_week",
): string => {
  if (!ANCHOR) return "";
  const { isoYear, isoWeek } = anchorIsoWeek();
  const bound = isoYear * 100 + isoWeek;
  const y = prefix ? `${prefix}${yearCol}` : yearCol;
  const w = prefix ? `${prefix}${weekCol}` : weekCol;
  return ` AND (${y} * 100 + ${w}) <= ${bound}`;
};

/**
 * 与上同，单独返回上限数字(供 JS 层拼参数)。
 * 未启用时返回 null。
 */
export const anchorIsoWeekBound = (): number | null => {
  if (!ANCHOR) return null;
  const { isoYear, isoWeek } = anchorIsoWeek();
  return isoYear * 100 + isoWeek;
};
