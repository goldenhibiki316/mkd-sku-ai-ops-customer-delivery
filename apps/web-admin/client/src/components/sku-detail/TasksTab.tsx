import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { polishAiText } from "@/lib/dictionaries";
import { getJSON } from "@/lib/queryClient";

type SkuTask = {
  id: string;
  task_type: string;
  priority?: number | null;
  title?: string | null;
  detail?: string | null;
  reason_summary?: string | null;
  status?: string | null;
  owner?: string | null;
  due_date?: string | null;
  created_at?: string | null;
};

type TasksResponse = {
  tasks: SkuTask[];
};

export function TasksTab({ sku, enabled }: { sku: string; enabled: boolean }) {
  const query = useQuery<TasksResponse>({
    queryKey: ["sku-tasks", sku],
    enabled,
    queryFn: ({ signal }) => getJSON<TasksResponse>(
      `/api/skus/${encodeURIComponent(sku)}/tasks`,
      signal,
    ),
    staleTime: 60_000,
  });

  if (!enabled) return null;

  if (query.isLoading) {
    return <StateCard message="相关任务加载中…" />;
  }

  if (query.isError || !query.data) {
    return (
      <StateCard
        message="相关任务加载失败"
        retry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  }

  const tasks = query.data.tasks;
  if (tasks.length === 0) {
    return <StateCard message="暂无相关任务" />;
  }

  return (
    <Card className="p-4">
      <div className="mb-3 text-sm font-medium">相关任务 ({tasks.length})</div>
      <div className="space-y-2">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="flex items-start justify-between gap-3 border-b border-border pb-2 text-xs last:border-0"
          >
            <div className="min-w-0">
              <div className="text-sm">{task.title || task.task_type}</div>
              <div className="mt-0.5 text-muted-foreground">
                {task.detail || "-"}
              </div>
            </div>
            <Badge variant="outline">{polishAiText(task.status) || "未同步"}</Badge>
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
      <div className="text-sm font-medium">相关任务</div>
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
