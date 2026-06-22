import { patchProfileSessionCache } from "@/lib/profile-session-cache";

export const AVATAR_UPDATED_EVENT = "roamie:avatar-updated";

export type AvatarUpdatedDetail = {
  url: string | null;
  revision?: number;
};

export function broadcastAvatarUpdate(url: string | null, revision?: number) {
  if (typeof window === "undefined") return;
  patchProfileSessionCache({ avatarUrl: url });
  window.dispatchEvent(
    new CustomEvent<AvatarUpdatedDetail>(AVATAR_UPDATED_EVENT, {
      detail: { url, revision: revision ?? Date.now() },
    }),
  );
}
