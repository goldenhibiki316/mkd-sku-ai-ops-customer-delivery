import type { PageMeta } from "../../shared/pagination";
import { AppHttpError } from "../httpErrors";

export class PageOutOfRangeError extends AppHttpError {
  readonly lastPage: number;

  constructor(lastPage: number) {
    super(
      400,
      "PAGE_OUT_OF_RANGE",
      `请求页码超出范围，最后一页为 ${lastPage}`,
      false,
    );
    this.name = "PageOutOfRangeError";
    this.lastPage = lastPage;
  }
}

class PaginationInputError extends AppHttpError {
  constructor(code: "PAGE_INVALID" | "PAGE_SIZE_INVALID", message: string) {
    super(400, code, message, false);
    this.name = "PaginationInputError";
  }
}

export function parsePagination(
  query: Record<string, unknown>,
  allowedPageSizes: readonly number[],
  defaultPageSize: number,
) {
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.page_size ?? defaultPageSize);

  if (!Number.isInteger(page) || page < 1) {
    throw new PaginationInputError("PAGE_INVALID", "页码必须为正整数");
  }
  if (!Number.isInteger(pageSize) || !allowedPageSizes.includes(pageSize)) {
    throw new PaginationInputError(
      "PAGE_SIZE_INVALID",
      "每页条数不在允许范围内",
    );
  }

  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
  };
}

export function pageMeta(
  total: number,
  page: number,
  pageSize: number,
): PageMeta {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (page > lastPage) {
    throw new PageOutOfRangeError(lastPage);
  }

  return {
    total,
    page,
    page_size: pageSize,
    last_page: lastPage,
    range_start: total === 0 ? 0 : (page - 1) * pageSize + 1,
    range_end: total === 0 ? 0 : Math.min(total, page * pageSize),
  };
}
