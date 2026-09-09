export const SUBSCRIPTION_HYDRATION_TIMEOUT_MS = 8_000;
export const SUBSCRIPTION_OFFERINGS_TIMEOUT_MS = 10_000;

export async function withSubscriptionTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  errorCode: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(errorCode)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
