import type { BudgetMode } from "@/lib/preferences-storage";
import type { TripLocation } from "@/lib/location/types";

const DRAFT_KEY = "roamie:plan-form-draft";

export type PlanFormDraft = {
  destination: TripLocation | null;
  origin: TripLocation | null;
  budgetMode: BudgetMode;
  styles: string[];
  mood: string;
  startDate: string;
  endDate: string;
  travelers: number;
  travelersCustom: boolean;
  transport: string;
};

export function savePlanFormDraft(draft: PlanFormDraft): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // ignore quota
  }
}

export function loadPlanFormDraft(): PlanFormDraft | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PlanFormDraft;
  } catch {
    return null;
  }
}

export function clearPlanFormDraft(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(DRAFT_KEY);
}
