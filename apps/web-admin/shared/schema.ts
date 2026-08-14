// SOP V3 + 锁定表 v1.1 数据模型(镜像真实 business.* 结构 + dev_v2.* 扩展预留)
import { z } from "zod";

// -- 15/18 类型字典(business.sku_type_dict)
export const skuTypeSchema = z.object({
  type_code: z.string(),
  category: z.string().nullable(),
  name_zh: z.string(),
  description: z.string().nullable(),
  priority: z.number(),
  display_color: z.string().nullable(),
  is_active: z.boolean(),
});
export type SkuType = z.infer<typeof skuTypeSchema>;

// -- SKU 主档(business.sku_master)
export const skuMasterSchema = z.object({
  sku: z.string(),
  product_name_zh: z.string().nullable(),
  brand_name: z.string().nullable(),
  category_id: z.string().nullable(),
  primary_shop: z.string().nullable(),
  shop_count: z.number().nullable(),
  current_type_code: z.string().nullable(),
  nature: z.string().nullable(),
  lifecycle: z.string().nullable(),
  season_tag: z.string().nullable(),
  unit_cost_clp: z.number().nullable(),
  weight_kg: z.number().nullable(),
  volume_cm3: z.number().nullable(),
});
export type SkuMaster = z.infer<typeof skuMasterSchema>;

// -- 周分类(business.sku_weekly_classification)
export const weeklyClsSchema = z.object({
  sku: z.string(),
  iso_year: z.number(),
  iso_week: z.number(),
  type_code: z.string(),
  weekly_gmv: z.number().nullable(),
  profit_margin: z.number().nullable(),
  turnover_days: z.number().nullable(),
  claim_rate: z.number().nullable(),
  confidence: z.number().nullable(),
  is_anomaly: z.boolean().nullable(),
  anomaly_severity: z.string().nullable(),
});
export type WeeklyCls = z.infer<typeof weeklyClsSchema>;

// -- 流转(business.sku_classification_transition)
export const transitionSchema = z.object({
  sku: z.string(),
  from_iso_year: z.number(),
  from_iso_week: z.number(),
  from_type_code: z.string(),
  to_iso_year: z.number(),
  to_iso_week: z.number(),
  to_type_code: z.string(),
  transition_kind: z.string().nullable(),
  primary_reason: z.string().nullable(),
  detected_at: z.string(),
});
export type Transition = z.infer<typeof transitionSchema>;

// -- AI 分析(business.sku_ai_analysis)
export const aiAnalysisSchema = z.object({
  sku: z.string(),
  iso_year: z.number(),
  iso_week: z.number(),
  analysis_at: z.string(),
  model_name: z.string().nullable(),
  dim_sales_diagnosis: z.string().nullable(),
  dim_profit_diagnosis: z.string().nullable(),
  dim_traffic_diagnosis: z.string().nullable(),
  dim_inventory_diagnosis: z.string().nullable(),
  dim_aftersales_diagnosis: z.string().nullable(),
  dim_competition_diagnosis: z.string().nullable(),
  dim_lifecycle_diagnosis: z.string().nullable(),
  overall_judgement: z.string().nullable(),
  risk_level: z.string().nullable(),
  risk_tags: z.array(z.string()).nullable(),
  next_week_actions: z.any().nullable(),
  ai_confidence: z.number().nullable(),
});
export type AiAnalysis = z.infer<typeof aiAnalysisSchema>;

// -- 运营任务(business.ops_task)
export const opsTaskSchema = z.object({
  id: z.string(),
  sku: z.string(),
  iso_year: z.number().nullable(),
  iso_week: z.number().nullable(),
  source: z.string().nullable(),
  task_type: z.string().nullable(),
  priority: z.number().nullable(),
  title: z.string(),
  detail: z.string().nullable(),
  reason_summary: z.string().nullable(),
  expected_impact: z.string().nullable(),
  status: z.string(),
  owner: z.string().nullable(),
  due_date: z.string().nullable(),
  created_at: z.string(),
});
export type OpsTask = z.infer<typeof opsTaskSchema>;

// -- 店铺(business.shop)
export const shopSchema = z.object({
  shop_name: z.string(),
  shop_type: z.string().nullable(),
  sku_count: z.number().nullable(),
  active_sku_count_30d: z.number().nullable(),
});
export type Shop = z.infer<typeof shopSchema>;

// -- 类型分布聚合
export const typeDistItemSchema = z.object({
  type_code: z.string(),
  name_zh: z.string(),
  category: z.string().nullable(),
  display_color: z.string().nullable(),
  priority: z.number(),
  sku_count: z.number(),
});
export type TypeDistItem = z.infer<typeof typeDistItemSchema>;

// -- 流转矩阵单元
export const transitionMatrixCellSchema = z.object({
  from_type_code: z.string(),
  to_type_code: z.string(),
  count: z.number(),
});
export type TransitionMatrixCell = z.infer<typeof transitionMatrixCellSchema>;
