export const COVER_UPDATED_EVENT = "roamie:cover-updated";

export function broadcastCoverUpdate(url: string | null): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(COVER_UPDATED_EVENT, { detail: url }));
}
