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
