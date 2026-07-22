/**
 * AI Credits Feature Flag
 *
 * Env: VITE_FEATURE_CREDITS_ENABLED (also FEATURE_CREDITS_ENABLED)
 * Storage: localStorage "roamie:feature-credits"
 *
 * Dev/test: set VITE_FEATURE_CREDITS_ENABLED=1 (full Check/Reserve/Commit/Rollback).
 * Production public: keep 0 until TestFlight verification; flip to 1 without rewriting runtime.
 *
 * When OFF: no deduct, no AI block, no formal ledger writes.
 */

export const CREDITS_FEATURE_STORAGE_KEY = "roamie:feature-credits";

const ENV_KEYS = ["VITE_FEATURE_CREDITS_ENABLED", "FEATURE_CREDITS_ENABLED"] as const;

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
    return parseTruthy(localStorage.getItem(CREDITS_FEATURE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export type CreditsFlagSource = "env" | "localStorage" | "default" | "testOverride";

export function resolveCreditsFeatureFlag(): {
  enabled: boolean;
  source: CreditsFlagSource;
} {
  if (testOverride != null) return { enabled: testOverride, source: "testOverride" };
  const fromStorage = readStorageFlag();
  if (fromStorage != null) return { enabled: fromStorage, source: "localStorage" };
  const fromEnv = readEnvFlag();
  if (fromEnv != null) return { enabled: fromEnv, source: "env" };
  return { enabled: false, source: "default" };
}

export function isCreditsFeatureEnabled(): boolean {
  return resolveCreditsFeatureFlag().enabled;
}

export function setCreditsFeatureEnabledOverride(enabled: boolean | null): void {
  testOverride = enabled;
}

export function setCreditsFeatureStorageFlag(enabled: boolean | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (enabled == null) {
      localStorage.removeItem(CREDITS_FEATURE_STORAGE_KEY);
      return;
    }
    localStorage.setItem(CREDITS_FEATURE_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}
