// 前端数据锚定:把"今天"替换为可配置的过去日期。
// 生效方式:.env / .env.production 里设 VITE_DATA_ANCHOR_DATE=YYYY-MM-DD
// 关闭方式:不设该变量(或设为空)即恢复真实"今天"。

const RAW = import.meta.env.VITE_DATA_ANCHOR_DATE?.trim();
const ANCHOR = RAW && /^\d{4}-\d{2}-\d{2}$/.test(RAW) ? RAW : null;

if (ANCHOR && typeof window !== "undefined") {
  // eslint-disable-next-line no-console
  console.log(`[anchor] VITE_DATA_ANCHOR_DATE=${ANCHOR} — 前端时间锚定已启用`);
}

/** 是否启用了数据锚定。 */
export const isAnchored = () => ANCHOR !== null;

/** 锚定的"今天"(YYYY-MM-DD)。未启用时返回真实今天。 */
export const anchorDateStr = (): string => {
  if (ANCHOR) return ANCHOR;
  return new Date().toISOString().slice(0, 10);
};

/** 锚定的"今天"(Date 对象,UTC 午夜)。 */
export const anchorDate = (): Date => {
  return new Date(anchorDateStr() + "T00:00:00Z");
};
