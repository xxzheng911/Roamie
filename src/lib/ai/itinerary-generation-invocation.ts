export type ItineraryInvocationValueType =
  | "undefined"
  | "null"
  | "object"
  | "string"
  | "number"
  | "boolean"
  | "other";

export type InvokeGenerateItineraryOptions = {
  generationId: string;
  transport: string;
  invoke: () => Promise<unknown>;
  timeoutMs?: number;
  signal?: AbortSignal;
};

function invocationValueType(value: unknown): ItineraryInvocationValueType {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "object") return "object";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return typeof value;
  }
  return "other";
}

function safeObjectKeys(value: unknown): string[] {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>).sort();
}

export function isEmptyGenerateItineraryInvocationResult(value: unknown): boolean {
  return (
    value == null ||
    (typeof value === "object" && !Array.isArray(value) && safeObjectKeys(value).length === 0)
  );
}

export function classifyGenerateItineraryInvocationResult(
  value: unknown,
): "invocation_empty_result" | null {
  return isEmptyGenerateItineraryInvocationResult(value) ? "invocation_empty_result" : null;
}

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export async function invokeGenerateItinerary({
  generationId,
  transport,
  invoke,
  timeoutMs,
  signal,
}: InvokeGenerateItineraryOptions): Promise<unknown> {
  const startedAt = Date.now();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;

  try {
    const invocation = Promise.resolve().then(invoke);
    const contenders: Promise<unknown>[] = [invocation];
    if (timeoutMs != null) {
      contenders.push(
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("itinerary_invocation_timeout")), timeoutMs);
        }),
      );
    }
    if (signal) {
      contenders.push(
        new Promise((_, reject) => {
          abortListener = () => reject(abortError("itinerary_invocation_aborted"));
          if (signal.aborted) abortListener();
          else signal.addEventListener("abort", abortListener, { once: true });
        }),
      );
    }
    const value = await Promise.race(contenders);
    const topLevelKeys = safeObjectKeys(value);
    console.info("[ITINERARY_INVOCATION_SETTLEMENT]", {
      generationId,
      settled: "resolved",
      resolvedValueType: invocationValueType(value),
      elapsedMs: Date.now() - startedAt,
      transport,
    });
    console.info("[ITINERARY_INVOCATION_RESULT]", {
      generationId,
      valueType: invocationValueType(value),
      isArray: Array.isArray(value),
      hasValue: value !== undefined && value !== null,
      objectKeyCount: topLevelKeys.length,
      topLevelKeys,
      promiseResolved: true,
      invocationThrew: false,
      transport,
    });
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const settled =
      error instanceof Error && error.name === "AbortError"
        ? "aborted"
        : message === "itinerary_invocation_timeout"
          ? "timeout"
          : "rejected";
    console.info("[ITINERARY_INVOCATION_SETTLEMENT]", {
      generationId,
      settled,
      resolvedValueType: "undefined",
      elapsedMs: Date.now() - startedAt,
      transport,
    });
    console.info("[ITINERARY_INVOCATION_RESULT]", {
      generationId,
      valueType: "undefined",
      isArray: false,
      hasValue: false,
      objectKeyCount: 0,
      topLevelKeys: [],
      promiseResolved: false,
      invocationThrew: true,
      transport,
    });
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
  }
}
