import { aiPayloadSchema, type AiPayload } from "../../../shared/ai3a";
import { normalizeRisk } from "./riskNormalizer";

const dimensions = [
  "sales",
  "profit",
  "traffic",
  "inventory",
  "aftersales",
  "competition",
  "lifecycle",
] as const;

const technicalText =
  /\bfallback\b|no_api_key|llm_failed|api[_ ]?key|密钥未配置|待接入\s*gpt/i;

type AiDimension = (typeof dimensions)[number];
type NormalizationStatus = "valid" | "incomplete" | "schema_invalid";

export interface NormalizeMeta {
  source: "generated" | "legacy";
  modelName: string | null;
  promptVersion: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function nonEmptyText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function nullableActionText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function resolvePriority(value: unknown): 1 | 2 | 3 | null {
  const priority = Number(value);
  return priority === 1 || priority === 2 || priority === 3
    ? priority
    : null;
}

function resolveClassification(raw: Record<string, unknown>, meta: NormalizeMeta) {
  const inputPayload = asRecord(raw.input_payload);
  const classification = asRecord(raw.classification);
  const value =
    nonEmptyText(raw.sop_v3_type) ??
    nonEmptyText(classification.value) ??
    nonEmptyText(classification.sop_v3_type) ??
    nonEmptyText(inputPayload.sop_v3_type);
  const triggerReasons =
    stringArray(raw.trigger_reasons).length > 0
      ? stringArray(raw.trigger_reasons)
      : stringArray(classification.trigger_reasons).length > 0
        ? stringArray(classification.trigger_reasons)
        : stringArray(inputPayload.trigger_reasons);

  return {
    value,
    trigger_reasons: triggerReasons,
    state: value
      ? ("available" as const)
      : meta.source === "legacy"
        ? ("legacy_unavailable" as const)
        : ("missing" as const),
  };
}

function resolveConclusion(raw: Record<string, unknown>) {
  const conclusionObject = asRecord(raw.conclusion);
  const conclusionRaw =
    nonEmptyText(raw.overall_judgement) ??
    nonEmptyText(raw.conclusion) ??
    nonEmptyText(conclusionObject.text);

  if (conclusionRaw && technicalText.test(conclusionRaw)) {
    return { text: null, state: "technical_error_removed" as const };
  }
  return conclusionRaw
    ? { text: conclusionRaw, state: "available" as const }
    : { text: null, state: "missing" as const };
}

function resolveRiskInputs(raw: Record<string, unknown>) {
  const risk = asRecord(raw.risk);
  const rawLevel = raw.risk_level ?? risk.raw_level ?? risk.level ?? null;
  const tagSource = raw.risk_tags ?? risk.raw_tags ?? risk.tags ?? [];
  const rawTags = Array.isArray(tagSource)
    ? tagSource.map((tag) =>
        isRecord(tag) ? tag.raw_value ?? tag.code ?? tag.label_zh : tag,
      )
    : [];
  return { rawLevel, rawTags };
}

function resolveDimensionSources(raw: Record<string, unknown>) {
  const inputPayload = asRecord(raw.input_payload);
  const evidenceSource = isRecord(raw.diagnosis)
    ? raw.diagnosis
    : isRecord(raw.evidence)
      ? raw.evidence
      : asRecord(inputPayload.diagnosis);
  const reasoningSource = asRecord(raw.reasoning);
  return { evidenceSource, reasoningSource };
}

function normalizeEvidenceItems(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => ({
      metric: nonEmptyText(item.metric),
      value: item.value ?? null,
      threshold: item.threshold ?? null,
      verdict: nonEmptyText(item.verdict),
    }));
}

function normalizeDimensions(
  raw: Record<string, unknown>,
  useReasoningAsLegacyEvidence: boolean,
) {
  const { evidenceSource, reasoningSource } = resolveDimensionSources(raw);
  const evidence = {} as AiPayload["evidence"];
  const reasoning = {} as AiPayload["reasoning"];

  for (const dimension of dimensions) {
    const evidenceValue = evidenceSource[dimension];
    const evidenceObject = asRecord(evidenceValue);
    const reasoningValue = reasoningSource[dimension];
    const reasoningObject = asRecord(reasoningValue);
    const explicitReasoningText =
      nonEmptyText(reasoningValue) ?? nonEmptyText(reasoningObject.text);
    const legacy = nonEmptyText(raw[`dim_${dimension}_diagnosis`]);
    const evidenceSummary =
      nonEmptyText(evidenceValue) ??
      nonEmptyText(evidenceObject.summary) ??
      legacy ??
      (useReasoningAsLegacyEvidence ? explicitReasoningText : null);
    const items = normalizeEvidenceItems(evidenceObject.evidence);
    evidence[dimension] = {
      summary: evidenceSummary,
      evidence: items,
      state:
        items.length > 0
          ? "complete"
          : evidenceSummary
            ? evidenceValue !== undefined && evidenceValue !== null
              ? "summary_only"
              : "legacy_text"
            : "missing",
    };

    const reasoningText =
      explicitReasoningText ??
      evidenceSummary;
    reasoning[dimension] = {
      text: reasoningText,
      state: reasoningText
        ? reasoningValue !== undefined && reasoningValue !== null
          ? "available"
          : legacy
            ? "legacy_text"
            : "available"
        : "missing",
    };
  }

  return { evidence, reasoning };
}

function normalizeActions(raw: Record<string, unknown>) {
  const inputPayload = asRecord(raw.input_payload);
  const primaryActions = Array.isArray(raw.actions)
    ? raw.actions
    : Array.isArray(inputPayload.actions)
      ? inputPayload.actions
      : [];
  const actionsSource = primaryActions.length > 0
    ? ("actions" as const)
    : ("next_week_actions" as const);
  const selected = primaryActions.length > 0
    ? primaryActions
    : Array.isArray(raw.next_week_actions)
      ? raw.next_week_actions
      : [];

  return selected
    .filter(isRecord)
    .slice(0, actionsSource === "actions" ? 8 : 5)
    .map((action) => ({
      source: actionsSource,
      task_type: nullableActionText(action.task_type),
      title: nullableActionText(action.title),
      specific_change: nullableActionText(
        action.specific_change ?? action.action,
      ),
      reason: nullableActionText(action.reason),
      owner: nullableActionText(action.owner),
      priority: resolvePriority(action.priority),
      guardrail: nullableActionText(action.guardrail),
    }));
}

function normalizeMissingInputs(
  raw: Record<string, unknown>,
  meta: NormalizeMeta,
) {
  const inputPayload = asRecord(raw.input_payload);
  const hasTopLevel = Object.prototype.hasOwnProperty.call(raw, "missing_inputs");
  const hasNested = Object.prototype.hasOwnProperty.call(
    inputPayload,
    "missing_inputs",
  );
  const source = hasTopLevel
    ? raw.missing_inputs
    : hasNested
      ? inputPayload.missing_inputs
      : undefined;
  const normalizedObject = asRecord(source);
  const objectState = nonEmptyText(normalizedObject.state);
  const objectItems = stringArray(normalizedObject.items);
  if (
    objectState &&
    [
      "reported",
      "none_reported",
      "not_returned",
      "legacy_unavailable",
    ].includes(objectState)
  ) {
    return {
      state: objectState as AiPayload["missing_inputs"]["state"],
      items: objectItems,
    };
  }

  if (Array.isArray(source)) {
    const items = stringArray(source);
    return items.length > 0
      ? { state: "reported" as const, items }
      : { state: "none_reported" as const, items: [] };
  }

  return meta.source === "legacy"
    ? { state: "legacy_unavailable" as const, items: [] }
    : { state: "not_returned" as const, items: [] };
}

export function normalizeAiPayload(rawValue: unknown, meta: NormalizeMeta): {
  status: NormalizationStatus;
  payload: AiPayload;
  diagnostics: string[];
} {
  const raw = asRecord(rawValue);
  const classification = resolveClassification(raw, meta);
  const conclusion = resolveConclusion(raw);
  const riskInputs = resolveRiskInputs(raw);
  const riskResult = normalizeRisk(riskInputs.rawLevel, riskInputs.rawTags);
  const { evidence, reasoning } = normalizeDimensions(
    raw,
    meta.source === "legacy",
  );
  const actions = normalizeActions(raw);
  const missingInputs = normalizeMissingInputs(raw, meta);
  const sourceMetadata = asRecord(raw.metadata);

  const validDimensionCount = dimensions.filter((dimension) =>
    Boolean(
      evidence[dimension].summary || evidence[dimension].evidence.length > 0,
    ),
  ).length;
  const businessUsable =
    conclusion.state === "available" && validDimensionCount >= 1;
  const elevatedRiskWithoutTags =
    (riskResult.value.level === "high" ||
      riskResult.value.level === "medium") &&
    riskResult.value.tags.length === 0;
  const incomplete =
    meta.source === "legacy" ||
    classification.state !== "available" ||
    missingInputs.state !== "none_reported" ||
    dimensions.some((dimension) => evidence[dimension].state !== "complete") ||
    actions.length === 0 ||
    riskResult.value.level === "pending" ||
    riskResult.value.level === "unknown" ||
    elevatedRiskWithoutTags ||
    riskResult.diagnostics.some((item) => item.startsWith("unknown_risk_tag:"));
  const status: NormalizationStatus = businessUsable
    ? incomplete
      ? "incomplete"
      : "valid"
    : "schema_invalid";

  const payload = aiPayloadSchema.parse({
    classification,
    conclusion,
    risk: riskResult.value,
    evidence,
    actions,
    reasoning,
    missing_inputs: missingInputs,
    metadata: {
      ...sourceMetadata,
      source: meta.source,
      model_name: meta.modelName,
      prompt_version: meta.promptVersion,
      competitor_input_count: 3,
    },
    schema_version: "3A.1",
  });

  return { status, payload, diagnostics: riskResult.diagnostics };
}

export type { AiDimension };
