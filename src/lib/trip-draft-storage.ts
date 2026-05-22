import type { RoamiePayloadV2 } from "@/lib/ai/types";

const DRAFT_KEY = "roamie:draft-trip";

/** AI 產生的行程草稿（未寫入 saved_trips） */
export function saveDraftTrip(payload: RoamiePayloadV2): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
}

export function loadDraftTrip(): RoamiePayloadV2 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as RoamiePayloadV2;
  } catch {
    return null;
  }
}

export function clearDraftTrip(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(DRAFT_KEY);
}
