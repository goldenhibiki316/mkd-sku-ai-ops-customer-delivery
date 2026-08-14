import type { UseQueryResult } from "@tanstack/react-query";
import { ExternalLink, HelpCircle, ImageOff } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { humanizeEvidence, polishAiText, weekLabel } from "@/lib/dictionaries";
import { presentMetric, type MetricStatus } from "@/lib/metricPresentation";

type NumericValue = number | string | null | undefined;

type SkuMaster = {
  sku: string;
  product_name?: string | null;
  image_url?: string | null;
  product_link?: string | null;
  brand_name?: string | null;
  primary_shop?: string | null;
  current_type_code?: string | null;
  season_tag?: string | null;
  lifecycle?: string | null;
};

type LatestWeekly = {
  iso_year?: number | null;
  iso_week?: number | null;
  weekly_gmv?: NumericValue;
  weekly_gmv_status?: MetricStatus;
  profit_margin?: NumericValue;
  profit_margin_status?: MetricStatus;
  turnover_days?: NumericValue;
  turnover_status?: MetricStatus;
  claim_rate?: NumericValue;
  claim_rate_status?: MetricStatus;
  evidence_json?: Record<string, unknown> | null;
};

export type SkuSummaryResponse = {
  master: SkuMaster;
  latest_weekly: LatestWeekly | null;
};

function synced(value: string | null | undefined) {
  return value ? polishAiText(value) : "未同步";
}

function MetricCell({ label, value }: { label: ReactNode; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function SkuSummary({
  query,
}: {
  query: UseQueryResult<SkuSummaryResponse, Error>;
}) {
  if (query.isLoading) {
    return <div className="text-sm text-muted-foreground">商品摘要加载中…</div>;
  }

  if (query.isError || !query.data) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-md border border-rose-200 bg-rose-50/60 px-4 py-3">
        <div>
          <div className="text-sm font-medium text-rose-700">商品摘要加载失败</div>
          <div className="mt-1 text-xs text-rose-700/80">页签内容仍可单独加载</div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
        >
          {query.isFetching ? "重试中" : "重试"}
        </Button>
      </div>
    );
  }

  const { master, latest_weekly: weekly } = query.data;
  const season = master.season_tag === "regular" ? "常规" : master.season_tag;
  const evidence = weekly?.evidence_json
    ? humanizeEvidence(weekly.evidence_json)
    : [];
  const period = weekly?.iso_year && weekly.iso_week
    ? weekLabel(weekly.iso_year, weekly.iso_week)
    : "最新周";

  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
          {master.image_url ? (
            <img
              src={master.image_url}
              alt={master.product_name ?? master.sku}
              className="h-full w-full object-cover"
            />
          ) : (
            <ImageOff className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold leading-snug">
            {master.product_name || `(未命名 ${master.sku})`}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="tabular-nums">SKU {master.sku}</span>
            <span>品牌 {synced(master.brand_name)}</span>
            <span>店铺 {synced(master.primary_shop)}</span>
            {master.product_link ? (
              <a
                href={master.product_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
                data-testid="link-product"
              >
                商品链接 <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span>暂无商品链接</span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="outline">分类 {synced(master.current_type_code)}</Badge>
            <Badge variant="outline">季节 {synced(season)}</Badge>
            <Badge variant="outline">生命周期 {synced(master.lifecycle)}</Badge>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs text-muted-foreground">{period}指标</div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <MetricCell
            label="周 GMV"
            value={presentMetric("gmv", weekly?.weekly_gmv, weekly?.weekly_gmv_status)}
          />
          <MetricCell
            label="毛利率"
            value={presentMetric("margin", weekly?.profit_margin, weekly?.profit_margin_status)}
          />
          <MetricCell
            label={(
              <span className="inline-flex items-center gap-1">
                <span>周转天数</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="周转天数口径说明"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <HelpCircle className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    此处沿用原总库存周转天数口径；AI 分析中的 Full 官方仓周转属于独立诊断指标。
                  </TooltipContent>
                </Tooltip>
              </span>
            )}
            value={presentMetric("turnover", weekly?.turnover_days, weekly?.turnover_status)}
          />
          <MetricCell
            label="索赔率"
            value={presentMetric("claim_rate", weekly?.claim_rate, weekly?.claim_rate_status)}
          />
        </div>
        {evidence.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>判定依据:</span>
            {evidence.slice(0, 6).map((item, index) => (
              <span key={index} className="text-foreground">{item}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
