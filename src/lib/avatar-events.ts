import { patchProfileSessionCache } from "@/lib/profile-session-cache";

export const AVATAR_UPDATED_EVENT = "roamie:avatar-updated";

export type AvatarUpdatedDetail = {
  url: string | null;
  revision?: number;
  userId?: string;
};

export function broadcastAvatarUpdate(url: string | null, revision?: number, userId?: string) {
  if (typeof window === "undefined") return;
  const updatedIso = new Date(revision ?? Date.now()).toISOString();
  patchProfileSessionCache({ avatarUrl: url, profileUpdatedAt: updatedIso }, userId);
  window.dispatchEvent(
    new CustomEvent<AvatarUpdatedDetail>(AVATAR_UPDATED_EVENT, {
      detail: { url, userId, revision: revision ?? Date.now() },
    }),
  );
}
