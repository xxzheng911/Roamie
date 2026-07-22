/**
 * Recommendation Engine R1.2 Feature Flag（Memory / DNA signals）
 *
 * 僅在 `VITE_REC_ENGINE_ENABLED` 為 ON 時生效。
 * 預設 OFF：不套用 Memory/DNA Weight Suggestion / Preference Signal。
 *
 * 啟用：`VITE_REC_ENGINE_R1_2_ENABLED=1` 或 localStorage `roamie:rec-engine-r1-2=1`
 */

export const REC_ENGINE_R1_2_STORAGE_KEY = "roamie:rec-engine-r1-2";

const ENV_KEYS = ["VITE_REC_ENGINE_R1_2_ENABLED", "REC_ENGINE_R1_2_ENABLED"] as const;

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
    return parseTruthy(localStorage.getItem(REC_ENGINE_R1_2_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function isRecEngineR12Enabled(): boolean {
  if (testOverride != null) return testOverride;
  const fromStorage = readStorageFlag();
  if (fromStorage != null) return fromStorage;
  const fromEnv = readEnvFlag();
  if (fromEnv != null) return fromEnv;
  return false;
}

export function setRecEngineR12EnabledOverride(enabled: boolean | null): void {
  testOverride = enabled;
}

export function setRecEngineR12StorageFlag(enabled: boolean | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (enabled == null) {
      localStorage.removeItem(REC_ENGINE_R1_2_STORAGE_KEY);
      return;
    }
    localStorage.setItem(REC_ENGINE_R1_2_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}
