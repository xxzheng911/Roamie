/**
 * Recommendation Engine Feature Flag（R0）
 *
 * 預設關閉：Explore 維持直呼 `sortExplorePlaces`，TestFlight 行為不變。
 * 啟用後：Explore 經 Adapter → Pipeline（R0 仍委派同一套排序，行為一致）。
 *
 * 啟用方式（任一即可）：
 * - 環境變數 `VITE_REC_ENGINE_ENABLED=1` 或 `REC_ENGINE_ENABLED=1`
 * - 瀏覽器 / WebView：`localStorage.setItem("roamie:rec-engine", "1")`
 *
 * 快速回退：
 * - 移除環境變數，或 `localStorage.setItem("roamie:rec-engine", "0")` / removeItem
 */

export const REC_ENGINE_STORAGE_KEY = "roamie:rec-engine";

const ENV_KEYS = ["VITE_REC_ENGINE_ENABLED", "REC_ENGINE_ENABLED"] as const;

/** 測試用覆寫；`null` 表示清除覆寫、回到 env/storage/default */
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
    return parseTruthy(localStorage.getItem(REC_ENGINE_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * 是否啟用 Recommendation Engine 路徑。
 * R0 預設 `false`：生產與 TestFlight 不改變既有 Explore 排序流程。
 */
export function isRecEngineEnabled(): boolean {
  if (testOverride != null) return testOverride;
  const fromStorage = readStorageFlag();
  if (fromStorage != null) return fromStorage;
  const fromEnv = readEnvFlag();
  if (fromEnv != null) return fromEnv;
  return false;
}

/** 執行期覆寫（開發／驗證用）；傳 `null` 清除覆寫 */
export function setRecEngineEnabledOverride(enabled: boolean | null): void {
  testOverride = enabled;
}

/** 寫入 localStorage 覆寫（僅 client） */
export function setRecEngineStorageFlag(enabled: boolean | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (enabled == null) {
      localStorage.removeItem(REC_ENGINE_STORAGE_KEY);
      return;
    }
    localStorage.setItem(REC_ENGINE_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}
