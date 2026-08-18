import { z } from 'zod';

const nonEmptyText = z.string().trim().min(1);

const generatedRiskTagSchema = z.object({
  code: nonEmptyText,
  label_zh: nonEmptyText,
  raw_value: nonEmptyText,
}).strict();

const generatedEvidenceItemSchema = z.object({
  metric: nonEmptyText,
  value: nonEmptyText.nullable(),
  threshold: nonEmptyText,
  verdict: nonEmptyText,
}).strict();

const generatedDimensionSchema = z.object({
  summary: nonEmptyText,
  evidence: z.array(generatedEvidenceItemSchema),
}).strict();

const generatedDiagnosisSchema = z.object({
  sales: generatedDimensionSchema,
  profit: generatedDimensionSchema,
  traffic: generatedDimensionSchema,
  inventory: generatedDimensionSchema,
  aftersales: generatedDimensionSchema,
  competition: generatedDimensionSchema,
  lifecycle: generatedDimensionSchema,
}).strict();

const generatedActionSchema = z.object({
  task_type: nonEmptyText,
  priority: z.number().int().min(1).max(3),
  title: nonEmptyText,
  specific_change: nonEmptyText,
  reason: nonEmptyText,
  guardrail: nonEmptyText,
  owner: nonEmptyText,
  based_on_real_data: z.boolean(),
  depends_on_fake_data: z.array(nonEmptyText),
}).strict();

export const generatedAnalysisResultSchema = z.object({
  schema_version: z.literal('3A.1'),
  sop_v3_type: nonEmptyText,
  trigger_reasons: z.array(nonEmptyText).min(1),
  overall_judgement: nonEmptyText,
  risk_level: z.enum(['high', 'medium', 'low', 'unknown', 'pending']),
  risk_tags: z.array(generatedRiskTagSchema),
  diagnosis: generatedDiagnosisSchema,
  actions: z.array(generatedActionSchema),
  missing_inputs: z.array(nonEmptyText),
}).strict();

export type GeneratedAnalysisResult = z.infer<typeof generatedAnalysisResultSchema>;
