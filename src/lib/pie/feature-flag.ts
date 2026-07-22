/**
 * PIE Facade Feature Flag（Phase 1 Step A）
 *
 * 預設關閉：既有 Places 呼叫端維持舊路徑，TestFlight 行為不變。
 * 啟用後：未來經 `places-gateway` 進入的呼叫會走 PIE Facade（目前仍委派至同一套舊實作）。
 *
 * 啟用方式（任一即可）：
 * - 環境變數 `VITE_PIE_FACADE_ENABLED=1` 或 `PIE_FACADE_ENABLED=1`
 * - 瀏覽器 / WebView：`localStorage.setItem("roamie:pie-facade", "1")`
 *
 * 快速回退：
 * - 移除環境變數，或 `localStorage.setItem("roamie:pie-facade", "0")` / removeItem
 * - 呼叫端未遷移時，關閉 flag 即等同完全不經 Facade
 */

export const PIE_FACADE_STORAGE_KEY = "roamie:pie-facade";

const ENV_KEYS = ["VITE_PIE_FACADE_ENABLED", "PIE_FACADE_ENABLED"] as const;

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
    return parseTruthy(localStorage.getItem(PIE_FACADE_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * 是否啟用「經 PIE Facade / places-gateway 路由」。
 * Step A 預設 `false`：生產與 TestFlight 不改變既有呼叫流程。
 */
export function isPieFacadeEnabled(): boolean {
  if (testOverride != null) return testOverride;
  const fromStorage = readStorageFlag();
  if (fromStorage != null) return fromStorage;
  const fromEnv = readEnvFlag();
  if (fromEnv != null) return fromEnv;
  return false;
}

/** 執行期覆寫（開發／驗證用）；傳 `null` 清除覆寫 */
export function setPieFacadeEnabledOverride(enabled: boolean | null): void {
  testOverride = enabled;
}

/** 寫入 localStorage 覆寫（僅 client） */
export function setPieFacadeStorageFlag(enabled: boolean | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (enabled == null) {
      localStorage.removeItem(PIE_FACADE_STORAGE_KEY);
      return;
    }
    localStorage.setItem(PIE_FACADE_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}
