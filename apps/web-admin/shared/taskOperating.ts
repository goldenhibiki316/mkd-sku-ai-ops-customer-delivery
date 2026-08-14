import { z } from "zod";

const nullableNumber = z.union([z.number(), z.string().transform(Number)]).nullable();

export const taskSkuOperatingFieldsSchema = z.object({
  sku: z.string(),
  product_name: z.string().nullable(),
  image_url: z.string().nullable(),
  brand_name: z.string().nullable(),
  primary_shop: z.string().nullable(),
  current_type_code: z.string().nullable(),
  type_name: z.string().nullable(),
  type_color: z.string().nullable(),
  metric_iso_year: z.number().int().nullable(),
  metric_iso_week: z.number().int().min(1).max(53).nullable(),
  weekly_gmv: nullableNumber,
  weekly_gmv_status: z.string(),
  profit_margin: nullableNumber,
  profit_margin_status: z.string(),
  turnover_days: nullableNumber,
  turnover_status: z.string(),
  claim_rate: nullableNumber,
  claim_rate_status: z.string(),
});

export type TaskSkuOperatingFields = z.infer<typeof taskSkuOperatingFieldsSchema>;

const DEFAULT_TASK_OPERATING_CONTRACT_VERSION = "task-operating-2.1";

export function resolveTaskOperatingContractVersion(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.TASK_OPERATING_CONTRACT_VERSION?.trim() ||
    DEFAULT_TASK_OPERATING_CONTRACT_VERSION;
}

export function resolveTaskReadModelEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.TASK_READ_MODEL_ENABLED?.trim().toLowerCase() === "true";
}

export const TASK_OPERATING_CONTRACT_VERSION =
  resolveTaskOperatingContractVersion();

export function sameOperatingFields(
  left: TaskSkuOperatingFields,
  right: TaskSkuOperatingFields,
): boolean {
  return Object.keys(taskSkuOperatingFieldsSchema.shape).every((key) =>
    Object.is(
      left[key as keyof TaskSkuOperatingFields],
      right[key as keyof TaskSkuOperatingFields],
    ),
  );
}
