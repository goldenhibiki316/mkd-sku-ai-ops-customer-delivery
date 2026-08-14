export type PageMeta = {
  total: number;
  page: number;
  page_size: number;
  last_page: number;
  range_start: number;
  range_end: number;
};

export type PaginatedResponse<T, K extends string> =
  & PageMeta
  & Record<K, T[]>;

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    request_id: string;
    last_page?: number;
  };
};
