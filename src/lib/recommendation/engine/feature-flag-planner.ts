/**
 * Recommendation Engine × Planner Integration Flag（P1）
 *
 * 預設 OFF：`rankPlacesForTripPlanning` 直呼 `filterAndRankTripPlacesForPlanning`。
 * 啟用後：經 Planner Adapter → Engine Pipeline（P1 score 仍委派 trip-place-scoring，行為對齊）。
 *
 * `VITE_REC_ENGINE_PLANNER_ENABLED=1` 或 localStorage `roamie:rec-engine-planner=1`
 */

export const REC_ENGINE_PLANNER_STORAGE_KEY = "roamie:rec-engine-planner";

const ENV_KEYS = ["VITE_REC_ENGINE_PLANNER_ENABLED", "REC_ENGINE_PLANNER_ENABLED"] as const;

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
    return parseTruthy(localStorage.getItem(REC_ENGINE_PLANNER_STORAGE_KEY));
  } catch {
    return null;
  }
}

export type RecEnginePlannerFlagSource = "env" | "localStorage" | "default";

/** 與 `isRecEnginePlannerEnabled` 相同優先序（storage → env → default）；不含 test override。 */
export function resolveRecEnginePlannerFlag(): {
  enabled: boolean;
  source: RecEnginePlannerFlagSource;
} {
  const fromStorage = readStorageFlag();
  if (fromStorage != null) return { enabled: fromStorage, source: "localStorage" };
  const fromEnv = readEnvFlag();
  if (fromEnv != null) return { enabled: fromEnv, source: "env" };
  return { enabled: false, source: "default" };
}

export function isRecEnginePlannerEnabled(): boolean {
  if (testOverride != null) return testOverride;
  return resolveRecEnginePlannerFlag().enabled;
}

export function setRecEnginePlannerEnabledOverride(enabled: boolean | null): void {
  testOverride = enabled;
}

export function setRecEnginePlannerStorageFlag(enabled: boolean | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (enabled == null) {
      localStorage.removeItem(REC_ENGINE_PLANNER_STORAGE_KEY);
      return;
    }
    localStorage.setItem(REC_ENGINE_PLANNER_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}
