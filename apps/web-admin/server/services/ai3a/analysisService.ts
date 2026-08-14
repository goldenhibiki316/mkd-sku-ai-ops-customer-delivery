import {
  aiAnalysisResponseSchema,
  aiHistoryResponseSchema,
  aiPayloadSchema,
  type AiAnalysisResponse,
  type AiHistoryResponse,
  type AiPayload,
} from "../../../shared/ai3a";
import { normalizeAiPayload } from "./payloadNormalizer";
import type { Ai3aRepository, AiAnalysisRow } from "./repository";

type AiAnalysisReader = Pick<
  Ai3aRepository,
  | "latestUsable"
  | "latestAttempt"
  | "usableHistory"
  | "generationHistory"
> & Partial<Pick<Ai3aRepository, "trendHistory">>;

const dimensions = [
  "sales",
  "profit",
  "traffic",
  "inventory",
  "aftersales",
  "competition",
  "lifecycle",
] as const;

export function emptyAiPayload(): AiPayload {
  const evidence = Object.fromEntries(
    dimensions.map((dimension) => [
      dimension,
      { summary: null, evidence: [], state: "missing" },
    ]),
  );
  const reasoning = Object.fromEntries(
    dimensions.map((dimension) => [
      dimension,
      { text: null, state: "missing" },
    ]),
  );

  return aiPayloadSchema.parse({
    classification: {
      value: null,
      trigger_reasons: [],
      state: "missing",
    },
    conclusion: { text: null, state: "missing" },
    risk: {
      level: "pending",
      label_zh: "风险等级待判定",
      color: "slate",
      tags: [],
      raw_level: null,
    },
    evidence,
    actions: [],
    reasoning,
    missing_inputs: { state: "not_returned", items: [] },
    metadata: {},
    schema_version: "3A.1",
  });
}

function toIsoString(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toISOString();
}

function toAnalysisSummary(
  row: AiAnalysisRow,
  status: "valid" | "incomplete" = row.analysis_status as "valid" | "incomplete",
) {
  return {
    analysis_id: row.analysis_id,
    analysis_status: status,
    analysis_time:
      toIsoString(row.finished_at) ??
      toIsoString(row.created_at) ??
      new Date(0).toISOString(),
    model_name: row.model_name ?? null,
    iso_year: Number(row.iso_year),
    iso_week: Number(row.iso_week),
  };
}

function toAttemptSummary(row: AiAnalysisRow) {
  const cost = row.cost_usd === null || row.cost_usd === undefined
    ? null
    : Number(row.cost_usd);
  return {
    analysis_id: row.analysis_id,
    analysis_status: row.analysis_status,
    started_at:
      toIsoString(row.started_at) ??
      toIsoString(row.created_at) ??
      new Date(0).toISOString(),
    finished_at: toIsoString(row.finished_at),
    model_name: row.model_name ?? null,
    error_code: row.error_code ?? null,
    error_message: row.error_message ?? null,
    token_used: row.token_used ?? null,
    cost_usd: cost !== null && Number.isFinite(cost) ? cost : null,
  };
}

export function normalizeStoredAnalysis(row: AiAnalysisRow): AiPayload {
  return normalizeStoredAnalysisRecord(row).payload;
}

type NormalizedStoredAnalysis = {
  payload: AiPayload;
  status: "valid" | "incomplete" | "schema_invalid";
};

type NormalizedAnalysisEntry = {
  row: AiAnalysisRow;
  normalized: NormalizedStoredAnalysis;
};

type NormalizedUsableEntry = {
  row: AiAnalysisRow;
  normalized: NormalizedStoredAnalysis & { status: "valid" | "incomplete" };
};

export function normalizeStoredAnalysisRecord(
  row: AiAnalysisRow,
): NormalizedStoredAnalysis {
  const migrated = Boolean(
    row.source_analysis_id || row.schema_version?.includes("migrated"),
  );
  const parsed = aiPayloadSchema.safeParse(row.analysis_payload);
  if (parsed.success && !migrated) {
    return {
      payload: parsed.data,
      status: row.analysis_status === "incomplete" ? "incomplete" : "valid",
    };
  }

  const normalized = normalizeAiPayload(row.analysis_payload, {
    source: migrated ? "legacy" : "generated",
    modelName: row.model_name ?? null,
    promptVersion: row.prompt_version ?? null,
  });
  return {
    payload: normalized.payload,
    status: normalized.status,
  };
}

function derivePageStatus(
  usableStatus: "valid" | "incomplete" | null,
  attempt: AiAnalysisRow | null,
): AiAnalysisResponse["analysis_status"] {
  if (
    attempt &&
    !["generating", "valid", "incomplete"].includes(attempt.analysis_status)
  ) {
    return "generation_failed";
  }
  if (usableStatus === "valid") return "valid";
  if (usableStatus === "incomplete") return "incomplete";
  return "no_analysis";
}

function normalizedUsableRows(rows: AiAnalysisRow[]) {
  return rows
    .map((row) => ({ row, normalized: normalizeStoredAnalysisRecord(row) }))
    .filter(isNormalizedUsableEntry);
}

function isNormalizedUsableEntry(
  entry: NormalizedAnalysisEntry | null,
): entry is NormalizedUsableEntry {
  return Boolean(entry && entry.normalized.status !== "schema_invalid");
}

export async function buildAiAnalysisResponse(
  repository: AiAnalysisReader,
  sku: string,
  options: { includeHistory?: boolean } = {},
): Promise<AiAnalysisResponse> {
  const includeHistory = options.includeHistory ?? true;
  const [storedUsable, attempt, requestedHistory, generationHistory] = await Promise.all([
    repository.latestUsable(sku),
    repository.latestAttempt(sku),
    includeHistory ? repository.usableHistory(sku) : Promise.resolve([]),
    includeHistory ? repository.generationHistory(sku) : Promise.resolve([]),
  ]);
  let normalizedHistory = normalizedUsableRows(requestedHistory);
  let current = storedUsable
    ? { row: storedUsable, normalized: normalizeStoredAnalysisRecord(storedUsable) }
    : null;
  if (current?.normalized.status === "schema_invalid") {
    if (!includeHistory) {
      normalizedHistory = normalizedUsableRows(
        await repository.usableHistory(sku),
      );
    }
    current = normalizedHistory[0] ?? null;
  }
  const usable = isNormalizedUsableEntry(current) ? current : null;
  const payload = usable?.normalized.payload ?? emptyAiPayload();

  return aiAnalysisResponseSchema.parse({
    ...payload,
    analysis_status: derivePageStatus(usable?.normalized.status ?? null, attempt),
    latest_valid_analysis: usable
      ? toAnalysisSummary(usable.row, usable.normalized.status)
      : null,
    latest_generation_attempt: attempt ? toAttemptSummary(attempt) : null,
    history: includeHistory
      ? normalizedHistory.map(({ row, normalized }) => ({
          ...toAnalysisSummary(row, normalized.status),
          risk: normalized.payload.risk,
          current: row.analysis_id === usable?.row.analysis_id,
          trend: {
            classification: normalized.payload.classification.value,
            conclusion: normalized.payload.conclusion.text,
            evidence: normalized.payload.evidence,
          },
        }))
      : [],
    generation_history: generationHistory.map(toAttemptSummary),
    schema_version: "3A.1",
  });
}

export async function buildAiHistoryResponse(
  repository: AiAnalysisReader,
  sku: string,
): Promise<AiHistoryResponse> {
  const trendHistoryPromise = repository.trendHistory
    ? repository.trendHistory(sku)
    : repository.usableHistory(sku);
  const [, history, trendHistory, generationHistory] = await Promise.all([
    repository.latestUsable(sku),
    repository.usableHistory(sku),
    trendHistoryPromise,
    repository.generationHistory(sku),
  ]);
  const normalizedHistory = normalizedUsableRows(history);
  const normalizedTrendHistory = normalizedUsableRows(trendHistory);
  const usable = normalizedHistory[0] ?? null;

  return aiHistoryResponseSchema.parse({
    history: normalizedHistory.map(({ row, normalized }) => ({
      ...toAnalysisSummary(row, normalized.status),
      risk: normalized.payload.risk,
      current: row.analysis_id === usable?.row.analysis_id,
      trend: {
        classification: normalized.payload.classification.value,
        conclusion: normalized.payload.conclusion.text,
        evidence: normalized.payload.evidence,
      },
    })),
    trend_history: normalizedTrendHistory.map(({ row, normalized }) => ({
      ...toAnalysisSummary(row, normalized.status),
      risk: normalized.payload.risk,
      current: row.analysis_id === usable?.row.analysis_id,
      trend: {
        classification: normalized.payload.classification.value,
        conclusion: normalized.payload.conclusion.text,
        evidence: normalized.payload.evidence,
      },
      record_count: Math.max(
        1,
        Number((row as AiAnalysisRow & { record_count?: number | string }).record_count ?? 1),
      ),
    })),
    generation_history: generationHistory.map(toAttemptSummary),
  });
}

export function toLegacyAiDetail(response: AiAnalysisResponse) {
  const current = response.latest_valid_analysis;
  const diagnosis = Object.fromEntries(
    dimensions.map((dimension) => [dimension, response.evidence[dimension]]),
  );
  const latestAi = current
    ? {
        id: current.analysis_id,
        iso_year: current.iso_year,
        iso_week: current.iso_week,
        analysis_at: current.analysis_time,
        model_name: current.model_name,
        status: current.analysis_status,
        input_payload: {
          v17: true,
          sop_v3_type: response.classification.value,
          trigger_reasons: response.classification.trigger_reasons,
          diagnosis,
          actions: response.actions,
          missing_inputs: response.missing_inputs.items,
        },
        dim_sales_diagnosis:
          response.reasoning.sales.text ?? response.evidence.sales.summary,
        dim_profit_diagnosis:
          response.reasoning.profit.text ?? response.evidence.profit.summary,
        dim_traffic_diagnosis:
          response.reasoning.traffic.text ?? response.evidence.traffic.summary,
        dim_inventory_diagnosis:
          response.reasoning.inventory.text ??
          response.evidence.inventory.summary,
        dim_aftersales_diagnosis:
          response.reasoning.aftersales.text ??
          response.evidence.aftersales.summary,
        dim_competition_diagnosis:
          response.reasoning.competition.text ??
          response.evidence.competition.summary,
        dim_lifecycle_diagnosis:
          response.reasoning.lifecycle.text ??
          response.evidence.lifecycle.summary,
        overall_judgement: response.conclusion.text,
        risk_level: response.risk.level,
        risk_tags: response.risk.tags.map((tag) => tag.label_zh),
        next_week_actions: response.actions.map((action) => ({
          action: action.specific_change ?? action.title,
          owner: action.owner,
          priority: action.priority,
        })),
      }
    : null;

  return {
    latest_ai: latestAi,
    ai_history: response.history.map((item) => ({
      id: item.analysis_id,
      iso_year: item.iso_year,
      iso_week: item.iso_week,
      analysis_at: item.analysis_time,
      model_name: item.model_name,
      risk_level: item.risk.level,
    })),
  };
}
