/** 訪客暫存用的 localStorage keys（登入 merge 後可清除） */
export const GUEST_STORAGE_KEYS = {
  flag: "roamie:guest",
  profile: "roamie:user-profile",
  preferences: "roamie:preferences",
  itineraries: "roamie:itineraries",
  places: "roamie:places",
  recommendations: "roamie:recommendations",
  chat: "roamie:chat",
} as const;

export function clearGuestLocalCaches(): void {
  if (typeof window === "undefined") return;
  for (const key of Object.values(GUEST_STORAGE_KEYS)) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }
}
