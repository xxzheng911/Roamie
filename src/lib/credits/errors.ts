export const INSUFFICIENT_CREDITS_ERROR_CODE = "INSUFFICIENT_CREDITS" as const;

export class InsufficientCreditsError extends Error {
  readonly code = INSUFFICIENT_CREDITS_ERROR_CODE;

  constructor() {
    super(INSUFFICIENT_CREDITS_ERROR_CODE);
    this.name = "InsufficientCreditsError";
  }
}

export function isInsufficientCreditsError(value: unknown): boolean {
  if (value instanceof InsufficientCreditsError) return true;
  if (!value || typeof value !== "object") return false;
  const record = value as {
    code?: unknown;
    errorCode?: unknown;
    message?: unknown;
    cause?: unknown;
  };
  return (
    record.code === INSUFFICIENT_CREDITS_ERROR_CODE ||
    record.errorCode === INSUFFICIENT_CREDITS_ERROR_CODE ||
    record.message === INSUFFICIENT_CREDITS_ERROR_CODE ||
    (record.cause !== value && isInsufficientCreditsError(record.cause))
  );
}
