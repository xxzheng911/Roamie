export const ACCESS_CHANGED_EVENT = "roamie:access-changed";

export function broadcastAccessChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ACCESS_CHANGED_EVENT));
}
