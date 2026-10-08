/** Race a promise with a timeout — used for Places API calls from the client */
export const CHAT_PLACES_SEARCH_TIMEOUT_MS = 10_000;

export async function withSearchTimeout<T>(
  promise: Promise<T>,
  ms = CHAT_PLACES_SEARCH_TIMEOUT_MS,
  message = "搜尋逾時，請稍後再試",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Bound a provider operation (including response body) and cancel its transport. */
export async function withAbortableSearchTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms = CHAT_PLACES_SEARCH_TIMEOUT_MS,
  parentSignal?: AbortSignal,
): Promise<T> {
  if (parentSignal?.aborted) throw new DOMException("Search superseded", "AbortError");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const stopped = new Promise<never>((_, reject) => {
    onAbort = () => {
      controller.abort();
      reject(new DOMException("Search superseded", "AbortError"));
    };
    parentSignal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      reject(new DOMException("places_search_attempt_timeout", "TimeoutError"));
      controller.abort();
    }, ms);
  });
  try {
    return await Promise.race([run(controller.signal), stopped]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) parentSignal?.removeEventListener("abort", onAbort);
  }
}
