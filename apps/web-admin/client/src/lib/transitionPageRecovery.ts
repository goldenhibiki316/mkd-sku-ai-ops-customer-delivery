export type TransitionPageError = {
  code?: string;
  last_page?: number;
};

export function getTransitionOutOfRangeRecoveryPage(
  error: TransitionPageError | null | undefined,
  recoveryUsed: boolean,
): number | null {
  if (
    recoveryUsed
    || error?.code !== "PAGE_OUT_OF_RANGE"
    || !Number.isInteger(error.last_page)
    || Number(error.last_page) < 1
  ) {
    return null;
  }
  return Number(error.last_page);
}
