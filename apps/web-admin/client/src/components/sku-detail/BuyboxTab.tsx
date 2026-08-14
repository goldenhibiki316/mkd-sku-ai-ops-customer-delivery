import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ExternalLink, ImageOff } from "lucide-react";

import AsyncState from "@/components/AsyncState";
import PaginationControls from "@/components/PaginationControls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ApiError, getJSON, rawApiRequest } from "@/lib/queryClient";
import { presentPrice } from "@/lib/metricPresentation";

type BuyboxRow = {
  sku: string;
  meli_id: string;
  snapshot_at: string;
  our_price: number | null;
  our_price_from_ops?: boolean;
  our_price_note?: string | null;
  our_price_source?: string | null;
  current_price: number | null;
  winner_price: number | null;
  price_to_win: number | null;
  current_price_source?: string | null;
  winner_price_source?: string | null;
  winner_gap_amount: number | null;
  winner_gap_rate: number | null;
  buybox_lost_flag: boolean | null;
  our_winner_flag: boolean | null;
  competitor_count: number | null;
  buybox_shipping_cost: number | null;
  abnormal_flag: boolean | null;
  under_review_flag: boolean | null;
};

type CompetitorRow = {
  competitor_meli_id: string;
  is_favorite: boolean | null;
  mapping_priority: number | null;
  mapping_source: string | null;
  title_similarity_score: number | null;
  image_similarity_score: number | null;
  competitor_title: string | null;
  competitor_price: number | null;
  competitor_base_price: number | null;
  competitor_sales_amount: number | null;
  competitor_stock: number | null;
  competitor_pred_rev_7d: number | null;
  review_rating: number | null;
  review_count: number | null;
  competitor_status: string | null;
  shipping_logistic_type: string | null;
  competitor_link: string | null;
  competitor_image: string | null;
  competitor_is_new: boolean | null;
  competitor_updated_at: string | null;
};

type BuyboxResponse = {
  listings: BuyboxRow[];
  competitors: CompetitorRow[];
  competitor_total: number;
  total: number;
  page: number;
  page_size: number;
  last_page: number;
  range_start: number;
  range_end: number;
};

type OurPricePayload = {
  meli_id: string;
  our_price: number;
  note: string | null;
};

export async function saveOurPriceOverride(
  sku: string,
  payload: OurPricePayload,
) {
  const response = await rawApiRequest(
    "PATCH",
    `/api/skus/${encodeURIComponent(sku)}/our-price`,
    payload,
  );
  if (!response.ok) {
    let message = `保存失败（HTTP ${response.status}）`;
    try {
      const body: unknown = await response.json();
      if (
        body !== null
        && typeof body === "object"
        && "error" in body
        && typeof body.error === "string"
        && body.error.trim()
      ) {
        message = body.error;
      }
    } catch {
      // Keep the safe HTTP fallback when the response body is not JSON.
    }
    throw new Error(message);
  }
  return response.json();
}

export function BuyboxTab({ sku, enabled }: { sku: string; enabled: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editMeliId, setEditMeliId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [editNote, setEditNote] = useState("");
  const [showCompetitors, setShowCompetitors] = useState(false);
  const [page, setPage] = useState(1);
  const outOfRangeRecoveryUsedRef = useRef(false);
  const query = useQuery<BuyboxResponse, ApiError>({
    queryKey: ["sku-buybox", sku, page],
    enabled,
    queryFn: ({ signal }) => getJSON<BuyboxResponse>(
      `/api/skus/${encodeURIComponent(sku)}/buybox?page=${page}&page_size=10`,
      signal,
    ),
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });
  const lastBuyboxDataRef = useRef<BuyboxResponse | undefined>(undefined);
  useEffect(() => {
    if (query.data) lastBuyboxDataRef.current = query.data;
  }, [query.data]);
  const visibleBuyboxData = query.data ?? lastBuyboxDataRef.current;
  const competitorsLocked = query.isFetching || query.isError;
  const showingPreviousCompetitors = Boolean(visibleBuyboxData) && competitorsLocked;

  useEffect(() => {
    if (
      !query.isError
      || !(query.error instanceof ApiError)
      || query.error.code !== "PAGE_OUT_OF_RANGE"
      || typeof query.error.last_page !== "number"
      || outOfRangeRecoveryUsedRef.current
    ) {
      return;
    }
    outOfRangeRecoveryUsedRef.current = true;
    setPage(query.error.last_page);
  }, [query.error, query.isError]);

  const handleCompetitorPageChange = (nextPage: number) => {
    outOfRangeRecoveryUsedRef.current = false;
    setPage(nextPage);
  };

  const handleCompetitorRetry = () => {
    outOfRangeRecoveryUsedRef.current = false;
    void query.refetch();
  };

  const saveMut = useMutation({
    mutationFn: (payload: OurPricePayload) => saveOurPriceOverride(sku, payload),
    onSuccess: () => {
      toast({ title: "已保存我方售价" });
      setEditMeliId(null);
      setEditPrice("");
      setEditNote("");
      void queryClient.invalidateQueries({ queryKey: ["sku-buybox", sku], exact: false });
    },
    onError: (error: Error) => {
      toast({
        title: "保存失败",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (!enabled) return null;

  if (query.isLoading && !visibleBuyboxData) {
    return <ModuleState title="Buybox / 竞对" message="Buybox 与竞品加载中…" />;
  }

  if (!visibleBuyboxData) {
    return (
      <ModuleState
        title="Buybox / 竞对"
        message="Buybox 与竞品加载失败"
        retry={handleCompetitorRetry}
        retrying={query.isFetching}
      />
    );
  }

  const rows = visibleBuyboxData.listings;
  const competitors = visibleBuyboxData.competitors;

  if (rows.length === 0) {
    return <ModuleState title="Buybox / 竞对" message="本 SKU 无 buybox 快照数据" />;
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-medium">
          Buybox / 竞对
          <span className="ml-1 text-xs text-muted-foreground">
            ({rows.length} listing / {visibleBuyboxData.competitor_total} 竞品)
          </span>
        </div>
      </div>

      <div className="space-y-3">
        {rows.map((row) => {
          const gapPct = row.winner_gap_rate != null
            ? Number(row.winner_gap_rate)
            : null;
          const gapAmt = row.winner_gap_amount != null
            ? Number(row.winner_gap_amount)
            : null;
          const lost = row.buybox_lost_flag === true
            || (row.our_winner_flag === false && row.winner_price != null);
          const missOurPrice = row.our_price == null;
          const missCurPrice = row.current_price == null;
          const missWinPrice = row.winner_price == null;
          const gaps: string[] = [];
          if (missOurPrice) gaps.push("我方售价");
          if (missCurPrice) gaps.push("当前挡价");
          if (missWinPrice) gaps.push("赢家价");
          const editing = editMeliId === row.meli_id;

          return (
            <div
              key={row.meli_id}
              className="rounded-md border border-border/60 bg-muted/20 p-3"
              data-testid={`buybox-row-${row.meli_id}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-xs">
                  <div className="font-medium">
                    <a
                      href={`https://articulo.mercadolibre.cl/${row.meli_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-dotted hover:text-primary"
                    >
                      {row.meli_id} <ExternalLink className="inline h-3 w-3" />
                    </a>
                  </div>
                  <div className="mt-0.5 text-muted-foreground">
                    快照:{new Date(row.snapshot_at).toLocaleString("zh-CN", { hour12: false })}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {lost && <Badge className="border border-red-200 bg-red-50 text-red-700">失去 Buybox</Badge>}
                  {row.our_winner_flag === true && (
                    <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700">拿下 Buybox</Badge>
                  )}
                  {row.abnormal_flag && (
                    <Badge variant="outline" className="border-amber-300 text-amber-700">异常</Badge>
                  )}
                  {row.under_review_flag && (
                    <Badge variant="outline" className="border-slate-300 text-slate-700">审核中</Badge>
                  )}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <PriceBox
                  label="我方售价"
                  value={row.our_price}
                  source={row.our_price_source}
                  tint={missOurPrice ? "missing" : row.our_price_from_ops ? "ops" : "data"}
                />
                <PriceBox
                  label="当前挡价"
                  value={row.current_price}
                  source={row.current_price_source}
                  tint={missCurPrice ? "missing" : "data"}
                />
                <PriceBox
                  label="赢家价"
                  value={row.winner_price}
                  source={row.winner_price_source}
                  tint={missWinPrice ? "missing" : "data"}
                />
              </div>

              {gaps.length > 0 && (
                <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                  数据缺口:{gaps.join(" / ")}
                </div>
              )}

              {gapAmt != null
                && gapPct != null
                && row.winner_price != null
                && row.our_price != null
                && !row.our_winner_flag && (
                <div className="mt-2 text-xs">
                  <span className="text-muted-foreground">价差:</span>
                  <span className="ml-1 font-medium tabular-nums">CLP {gapAmt.toLocaleString()}</span>
                  <span className="ml-2 text-muted-foreground">占:</span>
                  <span className="ml-1 font-medium tabular-nums">{(gapPct * 100).toFixed(2)}%</span>
                  {row.price_to_win != null && (
                    <>
                      <span className="ml-2 text-muted-foreground">拿下 buybox 目标价:</span>
                      <span className="ml-1 font-medium tabular-nums text-primary">
                        CLP {Number(row.price_to_win).toLocaleString()}
                      </span>
                    </>
                  )}
                </div>
              )}

              <div className="mt-3 border-t border-border/60 pt-3">
                {!editing ? (
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-muted-foreground">
                      {row.our_price_from_ops
                        ? <>运营回填售价 · {row.our_price_note ? <span>备注: {row.our_price_note}</span> : <span>(无备注)</span>}</>
                        : missOurPrice
                          ? "我方售价未回填,影响价差计算"
                          : "我方售价来自同步数据"}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => {
                        setEditMeliId(row.meli_id);
                        setEditPrice(row.our_price?.toString() || "");
                        setEditNote(row.our_price_note || "");
                      }}
                      data-testid={`btn-edit-our-price-${row.meli_id}`}
                    >
                      {row.our_price_from_ops ? "修改回填" : "手工回填我方售价"}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={editPrice}
                        onChange={(event) => setEditPrice(event.target.value)}
                        placeholder="CLP 售价"
                        className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
                        data-testid={`input-our-price-${row.meli_id}`}
                      />
                      <input
                        value={editNote}
                        onChange={(event) => setEditNote(event.target.value)}
                        placeholder="备注(可选)"
                        className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
                        maxLength={200}
                        data-testid={`input-our-price-note-${row.meli_id}`}
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => setEditMeliId(null)}
                        data-testid={`btn-cancel-our-price-${row.meli_id}`}
                      >
                        取消
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        disabled={saveMut.isPending || !editPrice || Number(editPrice) <= 0}
                        onClick={() => saveMut.mutate({
                          meli_id: row.meli_id,
                          our_price: Number(editPrice),
                          note: editNote || null,
                        })}
                        data-testid={`btn-save-our-price-${row.meli_id}`}
                      >
                        保存
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {visibleBuyboxData.competitor_total > 0 && (
        <div className="mt-4">
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowCompetitors((value) => !value)}
            data-testid="toggle-competitors"
          >
            {showCompetitors
              ? <ChevronDown className="h-3.5 w-3.5" />
              : <ChevronRight className="h-3.5 w-3.5" />}
            竞品清单({visibleBuyboxData.competitor_total})
          </button>
          {showCompetitors && (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <div>
                  <span>
                    共 {visibleBuyboxData.competitor_total} 个竞品；当前第 {visibleBuyboxData.range_start}—{visibleBuyboxData.range_end} 个
                  </span>
                  <span className="ml-2">按重点/优先级/销量排序</span>
                </div>
                <div className="flex items-center gap-2">
                  {showingPreviousCompetitors && (
                    <Badge variant="outline" className="font-normal">上次成功数据，仅供参考</Badge>
                  )}
                  {query.isFetching && visibleBuyboxData && (
                    <Badge variant="outline" className="font-normal">
                      正在加载第 {page} 页
                    </Badge>
                  )}
                </div>
              </div>

              {query.isError && (
                <AsyncState
                  status="error"
                  message="竞品列表加载失败，"
                  onRetry={handleCompetitorRetry}
                />
              )}

              <fieldset
                disabled={competitorsLocked}
                aria-busy={query.isFetching}
                className="m-0 min-w-0 border-0 p-0"
              >
                <div className={`space-y-2 transition-opacity ${
                  competitorsLocked && visibleBuyboxData ? "opacity-50 pointer-events-none" : "opacity-100"
                }`}>
                  {competitors.map((competitor) => (
                    <div
                      key={competitor.competitor_meli_id}
                      className="flex items-start gap-2 rounded border border-border/60 p-2"
                      data-testid={`competitor-row-${competitor.competitor_meli_id}`}
                    >
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                        {competitor.competitor_image ? (
                          <img
                            src={competitor.competitor_image}
                            alt=""
                            className="h-full w-full object-cover"
                            onError={(event) => { event.currentTarget.style.display = "none"; }}
                          />
                        ) : (
                          <ImageOff className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 text-xs">
                          {competitor.competitor_link ? (
                            <a
                              href={competitor.competitor_link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-primary"
                              aria-disabled={competitorsLocked}
                              tabIndex={competitorsLocked ? -1 : undefined}
                            >
                              {competitor.competitor_title || competitor.competitor_meli_id}{" "}
                              <ExternalLink className="inline h-3 w-3" />
                            </a>
                          ) : competitor.competitor_title || competitor.competitor_meli_id}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs tabular-nums text-muted-foreground">
                          {competitor.is_favorite && (
                            <Badge variant="outline" className="h-4 border-yellow-300 px-1 text-[10px] text-yellow-700">重点</Badge>
                          )}
                          {competitor.competitor_price != null && (
                            <span>CLP {Number(competitor.competitor_price).toLocaleString()}</span>
                          )}
                          {competitor.competitor_sales_amount != null && <span>销{competitor.competitor_sales_amount}</span>}
                          {competitor.review_rating != null && (
                            <span>★{Number(competitor.review_rating).toFixed(1)}({competitor.review_count ?? 0})</span>
                          )}
                          {competitor.competitor_is_new && (
                            <Badge variant="outline" className="h-4 px-1 text-[10px]">新品</Badge>
                          )}
                          {competitor.competitor_status && <span className="opacity-70">{competitor.competitor_status}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </fieldset>

              <PaginationControls
                total={visibleBuyboxData.competitor_total}
                page={visibleBuyboxData.page}
                pageSize={visibleBuyboxData.page_size}
                loading={competitorsLocked}
                onPageChange={handleCompetitorPageChange}
              />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function ModuleState({
  title,
  message,
  retry,
  retrying = false,
}: {
  title: string;
  message: string;
  retry?: () => unknown;
  retrying?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-2 text-xs text-muted-foreground">{message}</div>
      {retry && (
        <Button
          className="mt-3"
          size="sm"
          variant="outline"
          onClick={retry}
          disabled={retrying}
        >
          {retrying ? "重试中" : "重试"}
        </Button>
      )}
    </Card>
  );
}

function PriceBox({
  label,
  value,
  source,
  tint,
}: {
  label: string;
  value: number | null;
  source?: string | null;
  tint: "data" | "ops" | "missing";
}) {
  const background = tint === "missing"
    ? "bg-amber-50 border-amber-200"
    : tint === "ops"
      ? "bg-emerald-50 border-emerald-200"
      : "bg-background border-border/60";
  return (
    <div className={`rounded border ${background} px-2 py-1.5 text-center`}>
      <div className="text-[10px] text-muted-foreground">
        {label}{tint === "ops" && <span className="ml-1 text-emerald-700">•运营</span>}
      </div>
      <div className="mt-0.5 text-xs font-medium tabular-nums">
        {presentPrice(value, source)}
      </div>
    </div>
  );
}
