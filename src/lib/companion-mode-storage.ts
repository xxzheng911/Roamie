import type { PlanTier } from "@/lib/plan-tier/types";

/** Device-local：登入後是否已完成「選擇旅行陪伴方式」 */
export const COMPANION_MODE_COMPLETED_KEY = "roamie:companionModeCompleted";
export const COMPANION_MODE_TIER_KEY = "roamie:companionModeTier";

export function hasSelectedCompanionMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(COMPANION_MODE_COMPLETED_KEY) === "true";
  } catch {
    return false;
  }
}

export function readSelectedCompanionTier(): PlanTier | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(COMPANION_MODE_TIER_KEY);
    return raw === "plus" ? "plus" : raw === "free" ? "free" : null;
  } catch {
    return null;
  }
}

/** 立即寫入本機，讓導覽 gate 在 Supabase 同步完成前就能放行 */
export function markCompanionModeSelected(tier: PlanTier): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(COMPANION_MODE_COMPLETED_KEY, "true");
    localStorage.setItem(COMPANION_MODE_TIER_KEY, tier);
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearCompanionModeSelection(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(COMPANION_MODE_COMPLETED_KEY);
    localStorage.removeItem(COMPANION_MODE_TIER_KEY);
  } catch {
    /* ignore */
  }
}
