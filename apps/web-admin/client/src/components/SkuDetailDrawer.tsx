import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { getJSON } from "@/lib/queryClient";
import { AiAnalysisTab } from "@/components/sku-detail/AiAnalysisTab";
import { BuyboxTab } from "@/components/sku-detail/BuyboxTab";
import {
  SkuSummary,
  type SkuSummaryResponse,
} from "@/components/sku-detail/SkuSummary";
import { TasksTab } from "@/components/sku-detail/TasksTab";
import { TransitionsTab } from "@/components/sku-detail/TransitionsTab";
import { ArrowLeft } from "lucide-react";

type DetailTab = "ai" | "buybox" | "tasks" | "transitions";

type SkuDetailDrawerProps = {
  sku: string;
  onClose: () => void;
  onBack?: () => void;
  backLabel?: string;
};

export default function SkuDetailDrawer({
  sku,
  onClose,
  onBack,
  backLabel,
}: SkuDetailDrawerProps) {
  return (
    <SkuDetailDrawerContent
      key={sku}
      sku={sku}
      onClose={onClose}
      onBack={onBack}
      backLabel={backLabel}
    />
  );
}

function SkuDetailDrawerContent({
  sku,
  onClose,
  onBack,
  backLabel,
}: SkuDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>("ai");
  const summaryQuery = useQuery<SkuSummaryResponse>({
    queryKey: ["sku-summary", sku],
    queryFn: ({ signal }) => getJSON<SkuSummaryResponse>(
      `/api/skus/${encodeURIComponent(sku)}/summary`,
      signal,
    ),
    staleTime: 60_000,
  });

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-full sm:max-w-6xl p-0 overflow-hidden"
      >
        <div className="flex h-full flex-col">
          <div className="shrink-0 p-6 border-b">
            <SheetHeader>
              <div className="flex items-center gap-3 pr-8">
                {onBack && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={onBack}
                  >
                    <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
                    {backLabel ?? "返回"}
                  </Button>
                )}
                <SheetTitle>SKU 详情</SheetTitle>
              </div>
            </SheetHeader>
            <div className="mt-4">
              <SkuSummary query={summaryQuery} />
            </div>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as DetailTab)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <TabsList className="mx-6 mt-4 grid shrink-0 grid-cols-4">
              <TabsTrigger value="ai">AI 深度分析</TabsTrigger>
              <TabsTrigger value="buybox">Buybox / 竞对</TabsTrigger>
              <TabsTrigger value="tasks">相关任务</TabsTrigger>
              <TabsTrigger value="transitions">流转历史</TabsTrigger>
            </TabsList>
            <div className="flex-1 min-h-0 overflow-y-auto p-6">
              <TabsContent value="ai" className="mt-0">
                <AiAnalysisTab sku={sku} />
              </TabsContent>
              <TabsContent value="buybox" className="mt-0">
                <BuyboxTab sku={sku} enabled={activeTab === "buybox"} />
              </TabsContent>
              <TabsContent value="tasks" className="mt-0">
                <TasksTab sku={sku} enabled={activeTab === "tasks"} />
              </TabsContent>
              <TabsContent value="transitions" className="mt-0">
                <TransitionsTab sku={sku} enabled={activeTab === "transitions"} />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}
