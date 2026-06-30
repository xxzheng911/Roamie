/** Sanitize values before localStorage / Capacitor Preferences writes. */
export function sanitizeForJsonStorage<T>(value: T): T | null {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value ?? null)) as T;
  } catch {
    return null;
  }
}

export const NATIVE_TRAVEL_PREF_MAX_BYTES = 4_096;
export const LOCAL_TRAVEL_PREF_MAX_BYTES = 32_768;

export function logTravelPrefCacheWrite(key: string, payload: string): void {
  console.info("[TRAVEL_PREF_CACHE_WRITE]", {
    key,
    hasValue: payload.length > 0,
    valueSize: payload.length,
  });
}

export function logTravelPrefCacheWriteError(
  key: string,
  message: string,
  preview: unknown,
): void {
  let payloadPreview = "";
  try {
    if (typeof preview === "string") {
      payloadPreview = preview.slice(0, 80);
    } else {
      payloadPreview = JSON.stringify(preview)?.slice(0, 80) ?? "";
    }
  } catch {
    payloadPreview = String(preview).slice(0, 80);
  }
  console.warn("[TRAVEL_PREF_CACHE_WRITE_ERROR]", {
    key,
    message,
    payloadPreview,
  });
}

const TRAVEL_PREF_KNOWN_KEYS = new Set([
  "pace",
  "avoid",
  "vibe",
  "budgetMode",
  "budget",
  "interests",
  "onboarded",
  "personalityType",
  "personalitySummary",
  "updated_at",
]);

/** 字串被 spread 成 {0:"{",1:"\""...} 的 corrupted cache */
export function isCorruptedTravelPrefObject(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length === 0) return false;

  const numericKeys = keys.filter((k) => /^\d+$/.test(k));
  const hasKnown = keys.some((k) => TRAVEL_PREF_KNOWN_KEYS.has(k));
  if (numericKeys.length >= 8 && !hasKnown) return true;
  if (numericKeys.length > 0 && numericKeys.length / keys.length > 0.6 && !hasKnown) {
    return true;
  }
  return false;
}

export function safeJsonStringify(value: unknown, maxBytes?: number): string | null {
  const sanitized = sanitizeForJsonStorage(value);
  if (sanitized === null && value !== null && value !== undefined) return null;
  try {
    let payload = JSON.stringify(sanitized ?? null);
    if (typeof payload !== "string") return null;
    if (maxBytes != null && payload.length > maxBytes) return null;
    return payload;
  } catch {
    return null;
  }
}

export function stringifyWithinByteLimit(
  value: unknown,
  maxBytes: number,
  shrink?: (value: unknown) => unknown,
): string | null {
  let current = value;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const payload = safeJsonStringify(current);
    if (payload && payload.length <= maxBytes) return payload;
    if (!shrink) return null;
    current = shrink(current);
  }
  return safeJsonStringify(shrink ? shrink(value) : value, maxBytes);
}
