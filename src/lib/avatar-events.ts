export const AVATAR_UPDATED_EVENT = "roamie:avatar-updated";

export function broadcastAvatarUpdate(url: string | null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AVATAR_UPDATED_EVENT, { detail: url }));
}
