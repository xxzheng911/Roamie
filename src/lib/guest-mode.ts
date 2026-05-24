import { readGuestFlag, writeGuestFlag } from "@/lib/auth-session";

export const GUEST_MODE_CHANGED_EVENT = "roamie:guest-mode-changed";

/** 裝置本機訪客狀態（不建立 Supabase session） */
export function isGuestMode(): boolean {
  return readGuestFlag();
}

export function enableGuestMode(): void {
  writeGuestFlag(true);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(GUEST_MODE_CHANGED_EVENT, { detail: true }));
  }
}

export function disableGuestMode(): void {
  writeGuestFlag(false);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(GUEST_MODE_CHANGED_EVENT, { detail: false }));
  }
}
