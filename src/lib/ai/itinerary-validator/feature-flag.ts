/**
 * Itinerary Validator Feature Flag（Planner Integration P4.2）
 *
 * 預設 OFF：不跑結構化行程閘門（既有 validateItinerary / validateGeneratedDays 路徑不變）。
 * 啟用後：Planner 組裝後產出 ItineraryValidationResult（不重排、不重組、不新增地點）。
 *
 * 與以下 flags 獨立：
 * - VITE_REC_ENGINE_PLANNER_ENABLED
 * - VITE_REC_ENGINE_VALIDATOR_ENABLED（Recommendation Validator）
 * - VITE_PIE_PLANNER_SEARCH_ENABLED
 *
 * 啟用：`VITE_ITINERARY_VALIDATOR_ENABLED=1` 或
 * `localStorage.setItem("roamie:itinerary-validator", "1")`
 */

export const ITINERARY_VALIDATOR_STORAGE_KEY = "roamie:itinerary-validator";

const ENV_KEYS = ["VITE_ITINERARY_VALIDATOR_ENABLED", "ITINERARY_VALIDATOR_ENABLED"] as const;

let testOverride: boolean | null = null;

function parseTruthy(raw: string | undefined | null): boolean | null {
  if (raw == null) return null;
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return null;
}

function readEnvFlag(): boolean | null {
  for (const key of ENV_KEYS) {
    try {
      if (typeof process !== "undefined" && process.env?.[key] != null) {
        const parsed = parseTruthy(process.env[key]);
        if (parsed != null) return parsed;
      }
    } catch {
      /* ignore */
    }
    try {
      if (typeof import.meta !== "undefined" && import.meta.env) {
        const raw = (import.meta.env as Record<string, string | undefined>)[key];
        const parsed = parseTruthy(raw);
        if (parsed != null) return parsed;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function readStorageFlag(): boolean | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return parseTruthy(localStorage.getItem(ITINERARY_VALIDATOR_STORAGE_KEY));
  } catch {
    return null;
  }
}

export type ItineraryValidatorFlagSource = "env" | "localStorage" | "default";

/** 與 `isItineraryValidatorEnabled` 相同優先序（storage → env → default）；不含 test override。 */
export function resolveItineraryValidatorFlag(): {
  enabled: boolean;
  source: ItineraryValidatorFlagSource;
} {
  const fromStorage = readStorageFlag();
  if (fromStorage != null) return { enabled: fromStorage, source: "localStorage" };
  const fromEnv = readEnvFlag();
  if (fromEnv != null) return { enabled: fromEnv, source: "env" };
  return { enabled: false, source: "default" };
}

export function isItineraryValidatorEnabled(): boolean {
  if (testOverride != null) return testOverride;
  return resolveItineraryValidatorFlag().enabled;
}

export function setItineraryValidatorEnabledOverride(enabled: boolean | null): void {
  testOverride = enabled;
}

export function setItineraryValidatorStorageFlag(enabled: boolean | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (enabled == null) {
      localStorage.removeItem(ITINERARY_VALIDATOR_STORAGE_KEY);
      return;
    }
    localStorage.setItem(ITINERARY_VALIDATOR_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}
