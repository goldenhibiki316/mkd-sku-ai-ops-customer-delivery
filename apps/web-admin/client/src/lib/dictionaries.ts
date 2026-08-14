// 术语翻译层:代码 → 人类可读中文

export const kindZh = (k: string | null | undefined) => {
  const m: Record<string, string> = {
    upgrade: "分类升级",
    downgrade: "分类降级",
    lateral: "横向调整",
    lifecycle: "生命周期变化",
    seasonal: "季节切换",
  };
  return k && m[k] ? m[k] : k || "未标注";
};

// ISO year+week → "2026 年第 25 周 (6/16 – 6/22)"
function isoWeekToDates(year: number, week: number): { start: Date; end: Date } {
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dow = simple.getUTCDay() || 7;
  const isoStart = new Date(simple);
  isoStart.setUTCDate(simple.getUTCDate() - dow + 1);
  const isoEnd = new Date(isoStart);
  isoEnd.setUTCDate(isoStart.getUTCDate() + 6);
  return { start: isoStart, end: isoEnd };
}

export function weekLabel(year: number, week: number): string {
  const { start, end } = isoWeekToDates(year, week);
  const mmdd = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return `${year} 年第 ${String(week).padStart(2, "0")} 周 (${mmdd(start)}–${mmdd(end)})`;
}

// 用于 date input:ISO 周首日
export function isoWeekMonday(year: number, week: number): string {
  const { start } = isoWeekToDates(year, week);
  return start.toISOString().slice(0, 10);
}

// 日期 → { year, week }
export function dateToIsoWeek(dateStr: string): { year: number; week: number } {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((+d - +yearStart) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

export function fmtCLP(v: any): string {
  const n = typeof v === "string" ? Number(v) : v;
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `$${Math.round(n).toLocaleString("es-CL")} CLP`;
}

export function fmtPct(v: any, digits = 1): string {
  const n = typeof v === "string" ? Number(v) : v;
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtNum(v: any, digits = 1): string {
  const n = typeof v === "string" ? Number(v) : v;
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

export const riskLevelZh = (r: string | null | undefined) => {
  const m: Record<string, string> = { high: "高风险", medium: "中风险", low: "低风险" };
  return r && m[r] ? m[r] : r || "—";
};

// 阈值字段 -> 人类可读文案
const gmvFmt = (n: number) => `${Math.round(n / 1000)}K CLP`;
const pctFmt = (n: number) => `${Math.round(n * 100)}%`;
const seasonZh = (arr: string[]) =>
  arr
    .map((s) => ({ summer: "夏季", winter: "冬季", spring: "春季", autumn: "秋季", special: "特殊季" }[s] || s))
    .join("/");

export function humanizeThreshold(key: string, val: any): string | null {
  if (val === null || val === undefined) return null;
  switch (key) {
    case "weekly_gmv_min": return `周 GMV ≥ ${gmvFmt(Number(val))}`;
    case "weekly_gmv_max": return `周 GMV ≤ ${gmvFmt(Number(val))}`;
    case "gross_margin_min": return `毛利率 ≥ ${pctFmt(Number(val))}`;
    case "gross_margin_max": return `毛利率 ≤ ${pctFmt(Number(val))}`;
    case "claim_rate_min": return `索赔率 ≥ ${pctFmt(Number(val))}`;
    case "turnover_days_min": return `周转天数 ≥ ${val} 天`;
    case "weekly_orders_min": return `周订单量 ≥ ${val} 单`;
    case "weeks_since_listed_max": return `上架 ≤ ${val} 周`;
    case "acos_real_max": return `ACOS ≤ ${pctFmt(Number(val))}`;
    case "seasons_after_off": return `过季 ≥ ${val} 个季度未重新上架`;
    case "season_tag":
      return `适用季节:${seasonZh(Array.isArray(val) ? val : [String(val)])}`;
    case "in_suspend_window": return val === true ? "处于季节暂停窗口期" : null;
    case "is_clearing": return val === true ? "已标记为清货中" : null;
    default: return `${key}=${String(val)}`;
  }
}

export const riskLevelColor = (r: string | null | undefined) => {
  if (r === "high") return "bg-rose-100 text-rose-700 border-rose-200";
  if (r === "medium") return "bg-amber-100 text-amber-700 border-amber-200";
  if (r === "low") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
};

// evidence_json (SQL 判定阶段写入) → 人类可读短句
// evidence key 常见:method, gmv_mom, gmv_wow, weekly_gmv, weekly_orders, profit_margin,
//                    turnover_days, claim_rate, stockout_days, stockout_long, lifecycle,
//                    season_tag, in_suspend_window, is_clearing, weeks_since_listed 等
export function humanizeEvidence(ev: Record<string, unknown>): string[] {
  const out: string[] = [];
  const pushNum = (label: string, v: unknown, fmt: (n: number) => string) => {
    if (v === null || v === undefined || v === "") return;
    const n = Number(v);
    if (Number.isNaN(n)) return;
    out.push(`${label} ${fmt(n)}`);
  };
  const asPct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const asDays = (n: number) => `${Math.round(n)} 天`;
  const asCLPk = (n: number) => `${Math.round(n / 1000)}K CLP`;

  if (ev.weekly_gmv !== undefined) pushNum("本周 GMV", ev.weekly_gmv, asCLPk);
  if (ev.weekly_orders !== undefined) pushNum("周订单", ev.weekly_orders, (n) => `${Math.round(n)} 单`);
  if (ev.gmv_mom !== undefined) pushNum("环比上月", ev.gmv_mom, asPct);
  if (ev.gmv_wow !== undefined) pushNum("环比上周", ev.gmv_wow, asPct);
  if (ev.profit_margin !== undefined) pushNum("毛利率", ev.profit_margin, asPct);
  if (ev.turnover_days !== undefined) pushNum("周转", ev.turnover_days, asDays);
  if (ev.claim_rate !== undefined) pushNum("索赔率", ev.claim_rate, asPct);
  if (ev.stockout_days !== undefined) pushNum("缺货", ev.stockout_days, asDays);
  if (ev.stockout_long === true) out.push("长期缺货");
  if (ev.in_suspend_window === true) out.push("处于季节暂停期");
  if (ev.is_clearing === true) out.push("已进入清货状态");
  if (typeof ev.lifecycle === "string") {
    const map: Record<string, string> = { new: "新品期", ramp: "爬坡期", mature: "成熟期", decline: "衰退期", eol: "生命末期" };
    out.push(`生命周期:${map[ev.lifecycle] || ev.lifecycle}`);
  }
  if (typeof ev.season_tag === "string") {
    const smap: Record<string, string> = { summer: "夏季", winter: "冬季", spring: "春季", autumn: "秋季", special: "特殊季", regular: "全年" };
    // regular / 全年 销售属于普通情况，无需强调
    if (ev.season_tag !== "regular") {
      out.push(`适用季节:${smap[ev.season_tag] || ev.season_tag}`);
    }
  } else if (Array.isArray(ev.season_tag)) {
    const smap: Record<string, string> = { summer: "夏季", winter: "冬季", spring: "春季", autumn: "秋季", special: "特殊季" };
    out.push(`适用季节:${(ev.season_tag as string[]).map((s) => smap[s] || s).join("/")}`);
  }
  if (ev.weeks_since_listed !== undefined) pushNum("上架已", ev.weeks_since_listed, (n) => `${Math.round(n)} 周`);
  // method / rule_version / hit_rule 等纯技术字段一律忽略,不给运营人员看
  return out;
}

// 前端最后一道兜底:把历史 AI 结果里遗留的英文/代码/日期二次翻译成中文
// 保证即便旧模型生成的分析,也不会出现 R_XXX / WoW / MoM / ACOS / Buybox / mature / Wed Feb 04 等词
export function polishAiText(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = String(raw);
  // 类型代码
  const codeMap: Record<string, string> = {
    R_HIGH_CLAIM: "高赔付品", R_SLOW_LOW: "滞销品(低动销)", R_SLOW_MID: "滞销品(中动销)",
    R_CLEARANCE: "清货品", R_INV_HIGH: "高库存品", R_PROFIT_LOW: "低利润品",
    R_PROFIT_MID: "利润品(中销)", R_MASS_LOW: "走量低利润品", R_NEW_SLOW: "新品滞销",
    R_NORMAL_NEW: "常规新品", R_STAR: "明星品",
    S_TAIL: "尾货", S_SUSPEND: "季节暂停", S_DEAD: "过季死货",
  };
  for (const [k, v] of Object.entries(codeMap)) {
    s = s.replace(new RegExp("\\b" + k + "\\b", "g"), v);
  }
  // 生命周期 / 季节 英文
  const lcMap: Record<string, string> = { new: "新品期", ramp: "爬坡期", mature: "成熟期", decline: "衰退期", eol: "生命末期" };
  const seaMap: Record<string, string> = { summer: "夏季", winter: "冬季", spring: "春季", autumn: "秋季", regular: "全年", special: "特殊季" };
  for (const [k, v] of Object.entries(lcMap)) s = s.replace(new RegExp("\\b" + k + "\\b", "g"), v);
  for (const [k, v] of Object.entries(seaMap)) s = s.replace(new RegExp("\\b" + k + "\\b", "g"), v);
  // AI 风险标签（snake_case）
  const tagMap: Record<string, string> = {
    gmv_drop: "销量下滑", gmv_growth: "销量回升", traffic_loss: "流量下滑", traffic_growth: "流量回升",
    profit_low: "利润低", profit_high: "利润高", turnover_slow: "周转慢", turnover_fast: "周转快",
    stockout: "缺货", stockout_long: "长期缺货", claim_high: "高赔付", claim_low: "赔付低",
    mature_lifecycle: "成熟期", new_lifecycle: "新品期", decline_lifecycle: "衰退期",
    seasonal: "季节性", clearance: "清货", competitor_pressure: "竞品压力", buybox_loss: "失去购买框",
    published: "已发布", draft: "草稿", pending: "待处理", success: "完成", failed: "失败",
    open: "待处理", claimed: "已领取", doing: "处理中", in_progress: "处理中", done: "已完成", closed: "已关闭",
  };
  for (const [k, v] of Object.entries(tagMap)) {
    s = s.replace(new RegExp("\\b" + k + "\\b", "gi"), v);
  }
  // 财经缩写
  s = s.replace(/\bWoW\b/gi, "周环比").replace(/\bMoM\b/gi, "月环比").replace(/\bYoY\b/gi, "同比");
  s = s.replace(/\bACOS\b/gi, "广告花费占比");
  s = s.replace(/\bBuybox\b/gi, "购买框");
  s = s.replace(/\bGMV\b/g, "销售额");
  s = s.replace(/\bSKU\b/g, "商品");
  s = s.replace(/\bCLP\b/g, "智利比索");
  // 英文月份日期 "Wed Feb 04" / "Feb 04, 2024" 之类 → 移除或换成日期
  s = s.replace(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:,?\s*\d{4})?\b/gi, "较早日期");
  s = s.replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:,?\s*\d{4})?\b/gi, "较早日期");
  // stockout_long=true / method=xxx 类残留
  s = s.replace(/\b[a-z_]+\s*=\s*(?:true|false|null|"[^"]*"|'[^']*'|-?\d+(?:\.\d+)?)/gi, "");
  s = s.replace(/\[(HIGH|MEDIUM|LOW)\]/gi, "");
  // 裸露长数字 SKU
  s = s.replace(/\b\d{10,}\b/g, "该商品");
  // 多余空白清理
  s = s.replace(/\s{2,}/g, " ").replace(/\s([。,;!?、])/g, "$1").trim();
  return s;
}
