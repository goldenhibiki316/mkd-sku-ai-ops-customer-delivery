import * as React from "react";

import { Button } from "@/components/ui/button";

type PaginationControlsProps = {
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  onPageChange: (page: number) => void;
};

export function getPaginationSummary(
  total: number,
  page: number,
  pageSize: number,
) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  return {
    lastPage,
    rangeStart: total === 0 ? 0 : (page - 1) * pageSize + 1,
    rangeEnd: total === 0 ? 0 : Math.min(total, page * pageSize),
  };
}

export function getDisplayedPagination(response: {
  total: number;
  page: number;
  page_size: number;
}) {
  return {
    displayedPage: response.page,
    displayedPageSize: response.page_size,
    ...getPaginationSummary(response.total, response.page, response.page_size),
  };
}

export default function PaginationControls({
  total,
  page,
  pageSize,
  loading,
  onPageChange,
}: PaginationControlsProps) {
  const { lastPage } = getPaginationSummary(total, page, pageSize);
  if (lastPage <= 1) return null;

  const currentPage = Math.min(Math.max(page, 1), lastPage);
  const pageButtons: Array<number | "ellipsis"> = [];
  const push = (value: number | "ellipsis") => {
    if (pageButtons[pageButtons.length - 1] !== value) pageButtons.push(value);
  };
  const windowStart = Math.max(2, currentPage - 2);
  const windowEnd = Math.min(lastPage - 1, currentPage + 2);

  push(1);
  if (windowStart > 2) push("ellipsis");
  for (let pageNumber = windowStart; pageNumber <= windowEnd; pageNumber += 1) {
    push(pageNumber);
  }
  if (windowEnd < lastPage - 1) push("ellipsis");
  push(lastPage);

  return (
    <nav
      className="mt-4 flex flex-wrap items-center justify-center gap-1"
      aria-label="任务分页"
      aria-busy={loading}
      data-testid="pagination"
    >
      <Button
        variant="outline"
        size="sm"
        className="h-8 px-2"
        disabled={loading || currentPage <= 1}
        onClick={() => onPageChange(currentPage - 1)}
        aria-label={`上一页，当前第 ${currentPage} 页`}
        data-testid="button-page-prev"
      >
        上一页
      </Button>
      {pageButtons.map((pageNumber, index) =>
        pageNumber === "ellipsis" ? (
          <span
            key={`ellipsis-${index}`}
            className="px-1 text-xs text-muted-foreground"
            aria-hidden="true"
          >
            …
          </span>
        ) : (
          <Button
            key={pageNumber}
            variant={pageNumber === currentPage ? "default" : "outline"}
            size="sm"
            className="h-8 w-8 p-0 tabular-nums"
            onClick={() => onPageChange(pageNumber)}
            disabled={loading}
            aria-label={`第 ${pageNumber} 页`}
            aria-current={pageNumber === currentPage ? "page" : undefined}
            data-testid={`button-page-${pageNumber}`}
          >
            {pageNumber}
          </Button>
        )
      )}
      <Button
        variant="outline"
        size="sm"
        className="h-8 px-2"
        disabled={loading || currentPage >= lastPage}
        onClick={() => onPageChange(currentPage + 1)}
        aria-label={`下一页，当前第 ${currentPage} 页`}
        data-testid="button-page-next"
      >
        下一页
      </Button>
      <span className="ml-2 text-xs text-muted-foreground tabular-nums">
        第 {currentPage}/{lastPage} 页
      </span>
    </nav>
  );
}
