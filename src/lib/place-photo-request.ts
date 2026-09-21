export type PhotoAttemptOutcome = {
  attemptNumber: number;
  timeout: boolean;
  abort: boolean;
  rejected: boolean;
  errorClass: string | null;
};

/** Bound remote signing, including auth hydration. Always settle the image UI. */
export async function settlePlacePhotoRequest(
  request: (signal: AbortSignal, attemptNumber: number) => Promise<string | null>,
  timeoutMs = 8000,
  retryDelayMs = 300,
  onAttempt?: (outcome: PhotoAttemptOutcome) => void,
): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const outcome: PhotoAttemptOutcome = { attemptNumber: attempt + 1, timeout: false, abort: false, rejected: false, errorClass: null };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => request(controller.signal, attempt + 1)),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => { outcome.timeout = true; controller.abort(); resolve(null); }, timeoutMs);
        }),
      ]);
      if (result) return result;
    } catch (error) {
      outcome.rejected = true;
      const name = error instanceof Error ? error.name : "unknown";
      outcome.errorClass = ["TypeError", "AbortError", "SyntaxError", "ApiUrlError", "Error"].includes(name) ? name : "unknown";
    } finally {
      if (timer) clearTimeout(timer);
      outcome.abort = controller.signal.aborted || outcome.errorClass === "AbortError";
      onAttempt?.(outcome);
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  return null;
}
