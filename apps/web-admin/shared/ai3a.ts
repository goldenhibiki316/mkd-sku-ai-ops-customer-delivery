import { z } from "zod";

export const aiStoredStatusSchema = z.enum([
  "generating",
  "valid",
  "incomplete",
  "no_api_key",
  "model_failed",
  "schema_invalid",
  "server_failed",
]);

export const aiPageStatusSchema = z.enum([
  "valid",
  "incomplete",
  "generation_failed",
  "no_analysis",
]);

export const aiDimensionSchema = z.enum([
  "sales",
  "profit",
  "traffic",
  "inventory",
  "aftersales",
  "competition",
  "lifecycle",
]);

const riskTagSchema = z.object({
  code: z.string(),
  label_zh: z.string(),
  raw_value: z.string(),
});

export const normalizedRiskSchema = z.object({
  level: z.enum(["high", "medium", "low", "unknown", "pending"]),
  label_zh: z.string(),
  color: z.enum(["rose", "amber", "emerald", "slate"]),
  tags: z.array(riskTagSchema),
  raw_level: z.string().nullable(),
});

export const aiActionSchema = z.object({
  source: z.enum(["actions", "next_week_actions"]),
  task_type: z.string().nullable(),
  title: z.string().nullable(),
  specific_change: z.string().nullable(),
  reason: z.string().nullable(),
  owner: z.string().nullable(),
  priority: z.number().int().min(1).max(3).nullable(),
  guardrail: z.string().nullable(),
});

const evidenceItemSchema = z.object({
  metric: z.string().nullable(),
  value: z.unknown(),
  threshold: z.unknown(),
  verdict: z.string().nullable(),
});

const evidenceDimensionSchema = z.object({
  summary: z.string().nullable(),
  evidence: z.array(evidenceItemSchema),
  state: z.enum(["complete", "summary_only", "missing", "legacy_text"]),
});

const reasoningDimensionSchema = z.object({
  text: z.string().nullable(),
  state: z.enum(["available", "missing", "legacy_text"]),
});

const evidenceSchema = z.object({
  sales: evidenceDimensionSchema,
  profit: evidenceDimensionSchema,
  traffic: evidenceDimensionSchema,
  inventory: evidenceDimensionSchema,
  aftersales: evidenceDimensionSchema,
  competition: evidenceDimensionSchema,
  lifecycle: evidenceDimensionSchema,
});

export const aiHistoryTrendSchema = z.object({
  classification: z.string().nullable(),
  conclusion: z.string().nullable(),
  evidence: evidenceSchema,
});

const reasoningSchema = z.object({
  sales: reasoningDimensionSchema,
  profit: reasoningDimensionSchema,
  traffic: reasoningDimensionSchema,
  inventory: reasoningDimensionSchema,
  aftersales: reasoningDimensionSchema,
  competition: reasoningDimensionSchema,
  lifecycle: reasoningDimensionSchema,
});

export const aiPayloadSchema = z.object({
  classification: z.object({
    value: z.string().nullable(),
    trigger_reasons: z.array(z.string()),
    state: z.enum(["available", "missing", "legacy_unavailable"]),
  }),
  conclusion: z.object({
    text: z.string().nullable(),
    state: z.enum(["available", "missing", "technical_error_removed"]),
  }),
  risk: normalizedRiskSchema,
  evidence: evidenceSchema,
  actions: z.array(aiActionSchema),
  reasoning: reasoningSchema,
  missing_inputs: z.object({
    state: z.enum([
      "reported",
      "none_reported",
      "not_returned",
      "legacy_unavailable",
    ]),
    items: z.array(z.string()),
  }),
  metadata: z.record(z.string(), z.unknown()).default({}),
  schema_version: z.literal("3A.1"),
});

export const analysisSummarySchema = z.object({
  analysis_id: z.string().uuid(),
  analysis_status: z.enum(["valid", "incomplete"]),
  analysis_time: z.string(),
  model_name: z.string().nullable(),
  iso_year: z.number().int(),
  iso_week: z.number().int().min(1).max(53),
});

const aiHistorySummarySchema = analysisSummarySchema.extend({
  risk: normalizedRiskSchema,
  current: z.boolean(),
  trend: aiHistoryTrendSchema,
});

const aiTrendHistorySummarySchema = aiHistorySummarySchema.extend({
  record_count: z.number().int().positive(),
});

export const generationAttemptSchema = z.object({
  analysis_id: z.string().uuid(),
  analysis_status: aiStoredStatusSchema,
  started_at: z.string(),
  finished_at: z.string().nullable(),
  model_name: z.string().nullable(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  token_used: z.number().int().nullable().optional(),
  cost_usd: z.number().nullable().optional(),
});

export const aiAnalysisResponseSchema = aiPayloadSchema.extend({
  analysis_status: aiPageStatusSchema,
  latest_valid_analysis: analysisSummarySchema.nullable(),
  latest_generation_attempt: generationAttemptSchema.nullable(),
  history: z.array(aiHistorySummarySchema),
  generation_history: z.array(generationAttemptSchema),
});

export const aiHistoryResponseSchema = z.object({
  history: z.array(aiHistorySummarySchema),
  trend_history: z.array(aiTrendHistorySummarySchema),
  generation_history: z.array(generationAttemptSchema),
});

export const aiHistoryDetailResponseSchema = z.object({
  analysis: aiPayloadSchema,
  meta: analysisSummarySchema,
});

export type AiStoredStatus = z.infer<typeof aiStoredStatusSchema>;
export type AiPageStatus = z.infer<typeof aiPageStatusSchema>;
export type AiDimension = z.infer<typeof aiDimensionSchema>;
export type NormalizedRisk = z.infer<typeof normalizedRiskSchema>;
export type AiAction = z.infer<typeof aiActionSchema>;
export type AiPayload = z.infer<typeof aiPayloadSchema>;
export type AiAnalysisResponse = z.infer<typeof aiAnalysisResponseSchema>;
export type AiHistoryResponse = z.infer<typeof aiHistoryResponseSchema>;
export type AiHistoryDetailResponse = z.infer<
  typeof aiHistoryDetailResponseSchema
>;
