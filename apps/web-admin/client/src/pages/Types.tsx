import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, getJSON } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import AsyncState from "@/components/AsyncState";
import PaginationControls from "@/components/PaginationControls";
import SkuDetailDrawer from "@/components/SkuDetailDrawer";
import { BookOpen, ChevronDown, ChevronRight, ImageOff, Loader2 } from "lucide-react";
import { fmtCLP, fmtPct, humanizeThreshold } from "@/lib/dictionaries";
import { presentMetric, type MetricKind, type MetricStatus } from "@/lib/metricPresentation";

type TypeItem = {
  type_code: string;
  name_zh: string;
  category: string | null;
  display_color: string | null;
  priority: number | null;
  description: string | null;
  threshold_json: any;
  sku_count: number;
};

type Sku = {
  sku: string;
  product_name: string | null;
  image_url: string | null;
  brand_name: string | null;
  primary_shop: string | null;
  weekly_gmv: number | null;
  profit_margin: number | null;
  turnover_days: number | null;
  claim_rate: number | null;
  metric_iso_year: number | null;
  metric_iso_week: number | null;
  weekly_gmv_status: MetricStatus | null;
  profit_margin_status: MetricStatus | null;
  turnover_status: MetricStatus | null;
  claim_rate_status: MetricStatus | null;
};

type TypeSkuPageResponse = {
  skus: Sku[];
  total: number;
  page: number;
  page_size: number;
  last_page: number;
  range_start: number;
  range_end: number;
};

const TYPE_PAGE_SIZE = 20;

const presentMetricValue = (
  kind: MetricKind,
  value: number | null,
  status: MetricStatus | null,
): string => {
  const resolvedStatus = status ?? "observed";
  if (value === null || resolvedStatus !== "observed") {
    return presentMetric(kind, value, resolvedStatus);
  }
  if (kind === "gmv") return fmtCLP(value);
  if (kind === "turnover") return presentMetric(kind, value, resolvedStatus);
  return fmtPct(value, kind === "claim_rate" ? 2 : 1);
};

const liveDataQueryOptions = {
  staleTime: 60_000,
  refetchOnWindowFocus: true,
} as const;

const colorClass = (c: string | null) => {
  const m: Record<string, string> = {
    teal: "border-teal-500/60 bg-teal-50",
    emerald: "border-emerald-500/60 bg-emerald-50",
    amber: "border-amber-500/60 bg-amber-50",
    rose: "border-rose-500/60 bg-rose-50",
    slate: "border-slate-500/60 bg-slate-50",
    blue: "border-blue-500/60 bg-blue-50",
    orange: "border-orange-500/60 bg-orange-50",
    purple: "border-purple-500/60 bg-purple-50",
    lime: "border-lime-500/60 bg-lime-50",
  };
  return m[c || "slate"] || m.slate;
};

const categoryZh = (c: string | null) => {
  const m: Record<string, string> = {
    regular: "常规品",
    regular_new: "常规新品",
    regular_mature: "常规成熟品",
    seasonal: "季节品",
    季节品: "季节品",
  };
  return m[c || ""] || c || "-";
};

export default function Types() {
  const [selectedType, setSelectedType] = useState<TypeItem | null>(null);
  const [typePage, setTypePage] = useState(1);
  const [typeScrollTop, setTypeScrollTop] = useState(0);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [showAllDefs, setShowAllDefs] = useState(false);

  const { data } = useQuery<{ types: TypeItem[] }>({
    queryKey: ["/api/types"],
    ...liveDataQueryOptions,
  });
  const types = data?.types ?? [];

  const handleTypeOpen = (type: TypeItem) => {
    setSelectedType(type);
    setTypePage(1);
    setTypeScrollTop(0);
    setSelectedSku(null);
  };

  const handleTypeClose = () => {
    setSelectedType(null);
    setSelectedSku(null);
    setTypePage(1);
    setTypeScrollTop(0);
  };

  const handleTypePageChange = (page: number) => {
    setTypePage(page);
    setTypeScrollTop(0);
  };

  const handleSkuOpen = (sku: string, scrollTop: number) => {
    setTypeScrollTop(scrollTop);
    setSelectedSku(sku);
  };

  const handleSkuBack = () => {
    setSelectedSku(null);
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold" data-testid="text-types-title">SKU 分类分布</h1>
        <p className="text-sm text-muted-foreground mt-1">
          展示当前每一类的 SKU 数量与定义
        </p>
      </div>

      {/* 分类定义面板 */}
      <Collapsible open={showAllDefs} onOpenChange={setShowAllDefs}>
        <Card className="p-4">
          <CollapsibleTrigger className="w-full flex items-center justify-between" data-testid="button-toggle-defs">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">分类定义与判定标准</span>
              <span className="text-xs text-muted-foreground">(共 {types.length} 类,展开查看每类的详细定义、判定规则和阈值)</span>
            </div>
            <ChevronDown className={`w-4 h-4 transition-transform ${showAllDefs ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {types.map((t) => (
                <div key={t.type_code} className={`p-3 rounded-md border-l-4 ${colorClass(t.display_color)}`}>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">{t.name_zh}</div>
                    <Badge variant="outline" className="text-xs">{categoryZh(t.category)}</Badge>
                  </div>
                  {t.description && (
                    <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{t.description}</div>
                  )}
                  {t.threshold_json && typeof t.threshold_json === "object" && Object.keys(t.threshold_json).length > 0 && (
                    <div className="mt-2 text-xs flex flex-wrap gap-x-3 gap-y-1">
                      <span className="text-muted-foreground">判定条件:</span>
                      {Object.entries(t.threshold_json)
                        .map(([k, v]) => humanizeThreshold(k, v))
                        .filter((s): s is string => !!s)
                        .map((label, i) => (
                          <span key={i} className="text-foreground">{label}</span>
                        ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* 分类卡片 */}
      <div>
        <div className="text-sm font-medium mb-3">各分类当前 SKU 数量(点击查看该类下所有 SKU)</div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          {types.map((t) => (
            <button
              key={t.type_code}
              onClick={() => handleTypeOpen(t)}
              className="text-left"
              data-testid={`card-type-${t.type_code}`}
            >
              <Card className={`p-4 hover:shadow-md hover:border-primary/40 transition-all cursor-pointer border-l-4 ${colorClass(t.display_color)}`}>
                <div className="text-sm font-medium leading-tight">{t.name_zh}</div>
                <div className="text-xs text-muted-foreground mt-1">{categoryZh(t.category)}</div>
                <div className="text-2xl font-semibold mt-2 tabular-nums" data-testid={`count-${t.type_code}`}>{t.sku_count}</div>
                <div className="text-xs text-muted-foreground mt-1">个 SKU</div>
              </Card>
            </button>
          ))}
        </div>
      </div>

      {/* 分类和 SKU 始终只显示一层抽屉 */}
      {selectedSku ? (
        <SkuDetailDrawer
          sku={selectedSku}
          onClose={handleSkuBack}
          onBack={handleSkuBack}
          backLabel="返回分类列表"
        />
      ) : selectedType ? (
        <TypeDrawer
          type={selectedType}
          page={typePage}
          initialScrollTop={typeScrollTop}
          onClose={handleTypeClose}
          onPageChange={handleTypePageChange}
          onSkuClick={handleSkuOpen}
        />
      ) : null}
    </div>
  );
}

type TypeDrawerProps = {
  type: TypeItem;
  page: number;
  initialScrollTop: number;
  onClose: () => void;
  onPageChange: (page: number) => void;
  onSkuClick: (sku: string, scrollTop: number) => void;
};

function TypeDrawer({
  type,
  page,
  initialScrollTop,
  onClose,
  onPageChange,
  onSkuClick,
}: TypeDrawerProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const typeOutOfRangeRecoveryKeyRef = useRef<string | null>(null);
  const typeQueryKey = ["type-skus", type.type_code, page] as const;
  const typeRequestKey = JSON.stringify(typeQueryKey);
  const {
    data,
    error,
    isError,
    isFetching,
    isLoading,
    refetch,
  } = useQuery<TypeSkuPageResponse, ApiError>({
    queryKey: ["type-skus", type.type_code, page],
    queryFn: ({ signal }) => getJSON<TypeSkuPageResponse>(
      `/api/types/${encodeURIComponent(type.type_code)}/skus?page=${page}&page_size=20`,
      signal,
    ),
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });
  const lastTypeDataRef = useRef<TypeSkuPageResponse | undefined>(undefined);
  useEffect(() => {
    if (data) lastTypeDataRef.current = data;
  }, [data]);
  const visibleTypeData = data ?? lastTypeDataRef.current;
  const skus = visibleTypeData?.skus ?? [];

  useEffect(() => {
    if (
      !isError
      || !(error instanceof ApiError)
      || error.code !== "PAGE_OUT_OF_RANGE"
      || typeof error.last_page !== "number"
      || typeOutOfRangeRecoveryKeyRef.current === typeRequestKey
    ) {
      return;
    }
    typeOutOfRangeRecoveryKeyRef.current = typeRequestKey;
    onPageChange(error.last_page);
  }, [error, isError, onPageChange, typeRequestKey]);

  useLayoutEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = initialScrollTop;
    }
  }, [initialScrollTop, visibleTypeData?.page]);

  const handlePageChange = (nextPage: number) => {
    typeOutOfRangeRecoveryKeyRef.current = null;
    onPageChange(nextPage);
  };

  const handleRetry = () => {
    typeOutOfRangeRecoveryKeyRef.current = null;
    void refetch();
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        ref={scrollContainerRef}
        side="right"
        className="w-full sm:max-w-5xl overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className={`inline-block w-1.5 h-6 rounded-sm ${colorClass(type.display_color).replace("bg-", "bg-opacity-100 bg-")}`} style={{ background: `var(--color-${type.display_color || "slate"}-500)` }} />
            <span>{type.name_zh}</span>
            <Badge variant="outline">{categoryZh(type.category)}</Badge>
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* 定义 */}
          <Card className="p-3">
            <div className="text-xs font-medium text-muted-foreground mb-1">分类定义</div>
            <div className="text-sm">{type.description || "暂无定义"}</div>
            {type.threshold_json && typeof type.threshold_json === "object" && Object.keys(type.threshold_json).length > 0 && (
              <div className="mt-2 text-xs flex flex-wrap gap-x-3 gap-y-1">
                <span className="text-muted-foreground">判定条件:</span>
                {Object.entries(type.threshold_json)
                  .map(([k, v]) => humanizeThreshold(k, v))
                  .filter((s): s is string => !!s)
                  .map((label, i) => (
                    <span key={i} className="text-foreground">{label}</span>
                  ))}
              </div>
            )}
          </Card>

          {/* SKU 列表 */}
          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium">
                SKU 列表·共 {visibleTypeData?.total ?? 0} 个
              </div>
              {isFetching && visibleTypeData && (
                <Badge variant="outline" className="gap-1 font-normal">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  正在加载第 {page} 页
                </Badge>
              )}
            </div>

            {isLoading && !visibleTypeData && (
              <AsyncState status="loading" message={`正在加载第 ${page} 页`} />
            )}
            {isError && (
              <AsyncState
                status="error"
                message="分类 SKU 列表加载失败，"
                onRetry={handleRetry}
              />
            )}

            <div
              className={`space-y-3 transition-opacity ${
                isFetching && visibleTypeData ? "opacity-50 pointer-events-none" : ""
              }`}
            >
              {skus.map((s) => (
                <button
                  key={s.sku}
                  onClick={() => onSkuClick(
                    s.sku,
                    scrollContainerRef.current?.scrollTop ?? 0,
                  )}
                  className="w-full text-left"
                  data-testid={`sku-row-${s.sku}`}
                >
                  <Card className="hover:shadow-sm hover:border-primary/40 transition-all cursor-pointer">
                    <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center">
                      <div className="flex min-w-0 w-full shrink-0 items-center gap-3 lg:w-64">
                        <div className="w-16 h-16 shrink-0 rounded-md bg-muted overflow-hidden flex items-center justify-center">
                          {s.image_url ? (
                            <img src={s.image_url} alt={s.product_name ?? s.sku} className="w-full h-full object-cover" />
                          ) : (
                            <ImageOff className="w-5 h-5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium line-clamp-2">{s.product_name || `(未命名 ${s.sku})`}</div>
                          <div className="text-xs text-muted-foreground mt-1 tabular-nums">
                            SKU {s.sku}
                            {s.primary_shop && <span className="ml-2">· {s.primary_shop}</span>}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {s.brand_name || "品牌未同步"}
                            {s.metric_iso_year !== null && s.metric_iso_week !== null && (
                              <span className="ml-2 tabular-nums">· {s.metric_iso_year}-W{String(s.metric_iso_week).padStart(2, "0")}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 xl:grid-cols-4">
                        <div className="rounded-md border bg-muted/30 p-3">
                          <div className="text-xs text-muted-foreground">周 GMV</div>
                          <div className="mt-1 text-sm font-medium tabular-nums">{presentMetricValue("gmv", s.weekly_gmv, s.weekly_gmv_status)}</div>
                        </div>
                        <div className="rounded-md border bg-muted/30 p-3">
                          <div className="text-xs text-muted-foreground">毛利率</div>
                          <div className="mt-1 text-sm font-medium tabular-nums">{presentMetricValue("margin", s.profit_margin, s.profit_margin_status)}</div>
                        </div>
                        <div className="rounded-md border bg-muted/30 p-3">
                          <div className="text-xs text-muted-foreground">周转天数</div>
                          <div className="mt-1 text-sm font-medium tabular-nums">{presentMetricValue("turnover", s.turnover_days, s.turnover_status)}</div>
                        </div>
                        <div className="rounded-md border bg-muted/30 p-3">
                          <div className="text-xs text-muted-foreground">索赔率</div>
                          <div className="mt-1 text-sm font-medium tabular-nums">{presentMetricValue("claim_rate", s.claim_rate, s.claim_rate_status)}</div>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 shrink-0 self-end text-muted-foreground lg:self-auto" aria-hidden="true" />
                    </div>
                  </Card>
                </button>
              ))}
              {!isLoading && !isError && skus.length === 0 && (
                <div className="text-sm text-muted-foreground p-4 text-center">该分类当前无 SKU</div>
              )}
            </div>
            <PaginationControls
              total={visibleTypeData?.total ?? 0}
              page={visibleTypeData?.page ?? page}
              pageSize={TYPE_PAGE_SIZE}
              loading={isFetching}
              onPageChange={handlePageChange}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
