/**
 * Recommendation Validator Feature Flag（Planner Integration P4.1）
 *
 * 預設 OFF：pipeline `validate` 為 pass-through（R0 / P1–P3 行為不變）。
 * 啟用後：對已排序候選套用 Recommendation Validator 品質閘門（不重排）。
 *
 * 與 Rec Engine / Planner / PIE Search flags 獨立。
 *
 * 啟用：`VITE_REC_ENGINE_VALIDATOR_ENABLED=1` 或
 * `localStorage.setItem("roamie:rec-engine-validator", "1")`
 *
 * 回退：移除 env，或 storage 設 `"0"` / removeItem。
 */

export const REC_ENGINE_VALIDATOR_STORAGE_KEY = "roamie:rec-engine-validator";

const ENV_KEYS = ["VITE_REC_ENGINE_VALIDATOR_ENABLED", "REC_ENGINE_VALIDATOR_ENABLED"] as const;

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
    return parseTruthy(localStorage.getItem(REC_ENGINE_VALIDATOR_STORAGE_KEY));
  } catch {
    return null;
  }
}

export type RecEngineValidatorFlagSource = "env" | "localStorage" | "default";

/** 與 `isRecEngineValidatorEnabled` 相同優先序（storage → env → default）；不含 test override。 */
export function resolveRecEngineValidatorFlag(): {
  enabled: boolean;
  source: RecEngineValidatorFlagSource;
} {
  const fromStorage = readStorageFlag();
  if (fromStorage != null) return { enabled: fromStorage, source: "localStorage" };
  const fromEnv = readEnvFlag();
  if (fromEnv != null) return { enabled: fromEnv, source: "env" };
  return { enabled: false, source: "default" };
}

/** 是否啟用 Recommendation Validator 實閘。預設 `false`。 */
export function isRecEngineValidatorEnabled(): boolean {
  if (testOverride != null) return testOverride;
  return resolveRecEngineValidatorFlag().enabled;
}

export function setRecEngineValidatorEnabledOverride(enabled: boolean | null): void {
  testOverride = enabled;
}

export function setRecEngineValidatorStorageFlag(enabled: boolean | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (enabled == null) {
      localStorage.removeItem(REC_ENGINE_VALIDATOR_STORAGE_KEY);
      return;
    }
    localStorage.setItem(REC_ENGINE_VALIDATOR_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}
