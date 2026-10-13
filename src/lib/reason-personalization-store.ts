import {
  userProfileForReasonFrom,
  type UserProfileForReason,
} from "@/lib/build-place-recommendation-reason";
import { readCachedAuthenticatedUserIdSync } from "@/lib/auth-session";
import { getPreferences } from "@/lib/preferences-storage";
import { PREFS_UPDATED_EVENT } from "@/lib/preference-events";

/**
 * In-memory Plus reason profile shared by reason renderers. Owner-bound and never persisted:
 * Guest/Free get null, and a different signed-in user never reads another user's snapshot.
 * Reuses the existing preferences authority/cache; performs no AI or Places request.
 */
export const REASON_PROFILE_UPDATED = "roamie:reason-profile-updated";

let snapshot: { ownerUserId: string; profile: UserProfileForReason } | null = null;
/** Latest viewer requested by a renderer; async results for any other viewer are discarded. */
let active: { owner: string | null; plus: boolean } = { owner: null, plus: false };
let inflightOwner: string | null = null;
/** Bumped on every viewer/entitlement/preference change so stale loads cannot land. */
let generation = 0;
let listening = false;

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(REASON_PROFILE_UPDATED));
}

export function readReasonProfileSync(
  hasPlusAccess: boolean,
  currentUserId: string | null = readCachedAuthenticatedUserIdSync(),
): UserProfileForReason | null {
  if (!hasPlusAccess || !currentUserId) return null;
  return snapshot?.ownerUserId === currentUserId ? snapshot.profile : null;
}

function load(owner: string) {
  const gen = ++generation;
  inflightOwner = owner;
  getPreferences()
    .then((prefs) => {
      // Drop results superseded by a newer viewer, entitlement or preference change.
      if (gen !== generation || active.owner !== owner || !active.plus) return;
      if (readCachedAuthenticatedUserIdSync() !== owner) return;
      snapshot = {
        ownerUserId: owner,
        profile: userProfileForReasonFrom(prefs, { hasPlusAccess: true }),
      };
      notify();
    })
    .catch(() => {})
    .finally(() => {
      if (gen === generation) inflightOwner = null;
    });
}

export function ensureReasonProfile(
  hasPlusAccess: boolean,
  owner: string | null = readCachedAuthenticatedUserIdSync(),
): void {
  if (typeof window === "undefined") return;
  if (!listening) {
    listening = true;
    window.addEventListener(PREFS_UPDATED_EVENT, () => {
      snapshot = null;
      generation++;
      inflightOwner = null;
      notify();
      if (active.plus && active.owner) load(active.owner);
    });
  }
  if (active.owner !== owner || active.plus !== hasPlusAccess) {
    active = { owner, plus: hasPlusAccess };
    generation++;
    inflightOwner = null;
    // Sign-out / account switch / downgrade drops the previous owner's data from memory.
    if (snapshot && (snapshot.ownerUserId !== owner || !hasPlusAccess)) {
      snapshot = null;
      notify();
    }
  }
  if (!hasPlusAccess || !owner) return;
  if (snapshot?.ownerUserId === owner || inflightOwner === owner) return;
  load(owner);
}

/** Test/sign-out hook. */
export function resetReasonProfileStore(): void {
  snapshot = null;
  inflightOwner = null;
  active = { owner: null, plus: false };
  generation++;
}

/** Test-only seam: seed a snapshot without touching storage. */
export function __setReasonProfileSnapshotForTest(
  ownerUserId: string,
  profile: UserProfileForReason,
): void {
  snapshot = { ownerUserId, profile };
}
