import type { PlanTier } from "./types";

const DEBUG_AI_MODE_KEY = "roamie:debug-ai-mode";

/** 開發測試用：覆寫 AI plan tier（null = 使用 profile 設定） */
export function readDebugAiMode(): PlanTier | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(DEBUG_AI_MODE_KEY);
  if (raw === "free" || raw === "plus") return raw;
  return null;
}

export function writeDebugAiMode(mode: PlanTier | null): void {
  if (typeof window === "undefined") return;
  if (mode === null) {
    localStorage.removeItem(DEBUG_AI_MODE_KEY);
    return;
  }
  localStorage.setItem(DEBUG_AI_MODE_KEY, mode);
}
