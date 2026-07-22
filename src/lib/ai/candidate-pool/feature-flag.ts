/**
 * Candidate Pool Pipeline Feature Flag（RAOS Priority 1）
 *
 * 預設 OFF：既有 fetchComposedCategoryPlaces / 固定 Geo Hub 路徑不變。
 * 啟用後：Places Search → Quality → Category/Query → Geo Clustering →
 * Temporal → Travel Flow → Experience → Candidate Pool（不開 Validator / PIE Search）。
 *
 * 與以下 flags 獨立：
 * - VITE_REC_ENGINE_PLANNER_ENABLED
 * - VITE_REC_ENGINE_VALIDATOR_ENABLED
 * - VITE_ITINERARY_VALIDATOR_ENABLED
 * - VITE_PIE_PLANNER_SEARCH_ENABLED
 *
 * 啟用：`VITE_CANDIDATE_POOL_ENABLED=1` 或
 * `localStorage.setItem("roamie:candidate-pool", "1")`
 */

export const CANDIDATE_POOL_STORAGE_KEY = "roamie:candidate-pool";

const ENV_KEYS = ["VITE_CANDIDATE_POOL_ENABLED", "CANDIDATE_POOL_ENABLED"] as const;

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
    return parseTruthy(localStorage.getItem(CANDIDATE_POOL_STORAGE_KEY));
  } catch {
    return null;
  }
}

export type CandidatePoolFlagSource = "env" | "localStorage" | "default";

export function resolveCandidatePoolFlag(): {
  enabled: boolean;
  source: CandidatePoolFlagSource;
} {
  const fromStorage = readStorageFlag();
  if (fromStorage != null) return { enabled: fromStorage, source: "localStorage" };
  const fromEnv = readEnvFlag();
  if (fromEnv != null) return { enabled: fromEnv, source: "env" };
  return { enabled: false, source: "default" };
}

export function isCandidatePoolEnabled(): boolean {
  if (testOverride != null) return testOverride;
  return resolveCandidatePoolFlag().enabled;
}

export function setCandidatePoolEnabledOverride(enabled: boolean | null): void {
  testOverride = enabled;
}

export function setCandidatePoolStorageFlag(enabled: boolean | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (enabled == null) {
      localStorage.removeItem(CANDIDATE_POOL_STORAGE_KEY);
      return;
    }
    localStorage.setItem(CANDIDATE_POOL_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}
