import { patchProfileSessionCache } from "@/lib/profile-session-cache";

export const COVER_UPDATED_EVENT = "roamie:cover-updated";

export type CoverUpdatedDetail = {
  url: string | null;
  revision?: number;
};

export function broadcastCoverUpdate(url: string | null, revision?: number): void {
  if (typeof window === "undefined") return;
  patchProfileSessionCache({ coverImageUrl: url });
  window.dispatchEvent(
    new CustomEvent<CoverUpdatedDetail>(COVER_UPDATED_EVENT, {
      detail: { url, revision: revision ?? Date.now() },
    }),
  );
}
