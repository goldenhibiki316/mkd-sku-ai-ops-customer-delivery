import * as React from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

type AsyncStateProps = {
  status: "loading" | "error";
  message?: string;
  onRetry?: () => void;
  className?: string;
};

export default function AsyncState({
  status,
  message,
  onRetry,
  className = "",
}: AsyncStateProps) {
  const resolvedMessage = message ?? (
    status === "error" ? "加载失败，" : "加载中"
  );

  return (
    <div
      className={`flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground ${className}`}
      role={status === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      {status === "loading" && (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      )}
      <span>{resolvedMessage}</span>
      {status === "error" && onRetry && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto p-0"
          onClick={onRetry}
          aria-label="加载失败，重新加载"
        >
          重新加载
        </Button>
      )}
    </div>
  );
}
