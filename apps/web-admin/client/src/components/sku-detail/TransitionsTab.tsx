import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { polishAiText, weekLabel } from "@/lib/dictionaries";
import { getJSON } from "@/lib/queryClient";

type SkuTransition = {
  from_iso_year: number;
  from_iso_week: number;
  from_type_code?: string | null;
  to_iso_year: number;
  to_iso_week: number;
  to_type_code?: string | null;
  transition_kind?: string | null;
  primary_reason?: string | null;
  detected_at?: string | null;
};

type TransitionsResponse = {
  transitions: SkuTransition[];
};

export function TransitionsTab({
  sku,
  enabled,
}: {
  sku: string;
  enabled: boolean;
}) {
  const query = useQuery<TransitionsResponse>({
    queryKey: ["sku-transitions", sku],
    enabled,
    queryFn: ({ signal }) => getJSON<TransitionsResponse>(
      `/api/skus/${encodeURIComponent(sku)}/transitions`,
      signal,
    ),
    staleTime: 60_000,
  });

  if (!enabled) return null;

  if (query.isLoading) {
    return <StateCard message="流转历史加载中…" />;
  }

  if (query.isError || !query.data) {
    return (
      <StateCard
        message="流转历史加载失败"
        retry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  }

  const transitions = query.data.transitions;
  if (transitions.length === 0) {
    return <StateCard message="暂无流转历史" />;
  }

  return (
    <Card className="p-4">
      <div className="mb-3 text-sm font-medium">流转历史 ({transitions.length})</div>
      <div className="space-y-2">
        {transitions.map((transition, index) => (
          <div
            key={`${transition.detected_at ?? "transition"}-${index}`}
            className="flex flex-wrap items-center gap-2 border-b border-border py-2 text-xs last:border-0"
          >
            <span className="tabular-nums text-muted-foreground">
              {weekLabel(transition.to_iso_year, transition.to_iso_week)}
            </span>
            <Badge variant="outline">
              {polishAiText(transition.from_type_code) || "未同步"}
            </Badge>
            <span>→</span>
            <Badge variant="outline">
              {polishAiText(transition.to_type_code) || "未同步"}
            </Badge>
            <span className="min-w-0 flex-1 text-muted-foreground">
              {polishAiText(transition.primary_reason) || "-"}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function StateCard({
  message,
  retry,
  retrying = false,
}: {
  message: string;
  retry?: () => unknown;
  retrying?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="text-sm font-medium">流转历史</div>
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
