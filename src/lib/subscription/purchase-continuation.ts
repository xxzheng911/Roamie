export type PlusPurchaseContinuation = "open_paywall" | "restore_purchases";

const STORAGE_KEY = "roamie:plus-purchase-continuation";
const MAX_AGE_MS = 30 * 60 * 1_000;

type StoredContinuation = {
  action: PlusPurchaseContinuation;
  createdAt: number;
};

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function savePlusPurchaseContinuation(
  action: PlusPurchaseContinuation,
  now = Date.now(),
): boolean {
  const target = storage();
  if (!target) return false;
  try {
    target.setItem(
      STORAGE_KEY,
      JSON.stringify({ action, createdAt: now } satisfies StoredContinuation),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearPlusPurchaseContinuation(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // A blocked sessionStorage must not break authentication.
  }
}

/** Atomically removes a fresh continuation so route remounts cannot replay it. */
export function consumePlusPurchaseContinuation(now = Date.now()): PlusPurchaseContinuation | null {
  const target = storage();
  if (!target) return null;
  let raw: string | null = null;
  try {
    raw = target.getItem(STORAGE_KEY);
    target.removeItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredContinuation>;
    if (
      (parsed.action !== "open_paywall" && parsed.action !== "restore_purchases") ||
      typeof parsed.createdAt !== "number" ||
      now - parsed.createdAt < 0 ||
      now - parsed.createdAt > MAX_AGE_MS
    ) {
      return null;
    }
    return parsed.action;
  } catch {
    return null;
  }
}
