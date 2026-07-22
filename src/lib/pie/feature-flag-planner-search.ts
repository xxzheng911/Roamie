/**
 * PIE Planner Search Feature Flag（Planner Integration P3）
 *
 * 預設 OFF：Planner 候選搜尋仍使用呼叫端注入的 PlaceSearchFn（legacy）。
 * 啟用後：Planner 入口經 `wrapPlannerPlaceSearchViaGateway` 走 PIE Gateway（Search）。
 *
 * 與 `VITE_PIE_FACADE_ENABLED`（Detail / Autocomplete）及
 * `VITE_REC_ENGINE_PLANNER_ENABLED`（排序）獨立，可單獨回退。
 *
 * 啟用：`VITE_PIE_PLANNER_SEARCH_ENABLED=1` 或
 * `localStorage.setItem("roamie:pie-planner-search", "1")`
 *
 * 回退：移除 env，或 storage 設 `"0"` / removeItem。
 */

export const PIE_PLANNER_SEARCH_STORAGE_KEY = "roamie:pie-planner-search";

const ENV_KEYS = ["VITE_PIE_PLANNER_SEARCH_ENABLED", "PIE_PLANNER_SEARCH_ENABLED"] as const;

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
    return parseTruthy(localStorage.getItem(PIE_PLANNER_SEARCH_STORAGE_KEY));
  } catch {
    return null;
  }
}

export type PiePlannerSearchFlagSource = "env" | "localStorage" | "default";

/** 與 `isPiePlannerSearchEnabled` 相同優先序（storage → env → default）；不含 test override。 */
export function resolvePiePlannerSearchFlag(): {
  enabled: boolean;
  source: PiePlannerSearchFlagSource;
} {
  const fromStorage = readStorageFlag();
  if (fromStorage != null) return { enabled: fromStorage, source: "localStorage" };
  const fromEnv = readEnvFlag();
  if (fromEnv != null) return { enabled: fromEnv, source: "env" };
  return { enabled: false, source: "default" };
}

/** 是否啟用「Planner 候選搜尋經 PIE Gateway」。預設 `false`。 */
export function isPiePlannerSearchEnabled(): boolean {
  if (testOverride != null) return testOverride;
  return resolvePiePlannerSearchFlag().enabled;
}

export function setPiePlannerSearchEnabledOverride(enabled: boolean | null): void {
  testOverride = enabled;
}

export function setPiePlannerSearchStorageFlag(enabled: boolean | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (enabled == null) {
      localStorage.removeItem(PIE_PLANNER_SEARCH_STORAGE_KEY);
      return;
    }
    localStorage.setItem(PIE_PLANNER_SEARCH_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}
