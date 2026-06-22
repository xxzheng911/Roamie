import { getClientAuthSession } from "@/lib/auth-session";
import { buildAccessSnapshot } from "@/lib/access";
import { getUserPlanProfile } from "@/lib/plan-tier/storage";
import { isPersonaTypeLabel, PERSONA_TYPE_LABELS } from "@/lib/personality";
import type { TravelPreferences } from "@/lib/preferences-storage";
import type { UserProfile } from "@/lib/profile-storage";

export async function resolveProfileHasPlusAccess(): Promise<boolean> {
  const session = await getClientAuthSession();
  const email = session?.user?.email ?? null;
  const userId = session?.user?.id ?? null;
  let profilePlusActive = false;
  if (userId) {
    try {
      const plan = await getUserPlanProfile(userId);
      profilePlusActive =
        plan.planTier === "plus" &&
        (plan.subscriptionStatus === "active" || plan.subscriptionStatus === "trialing");
    } catch {
      profilePlusActive = false;
    }
  }
  return buildAccessSnapshot(email, { profilePlusActive }).hasPlusAccess;
}

export function shouldExposePlusPersona(
  hasPlusAccess: boolean,
  prefs: TravelPreferences,
): boolean {
  return hasPlusAccess && Boolean(prefs.onboarded);
}

/** 移除誤寫進 bio 的測驗人格名稱（Free 帳號） */
export function sanitizeBioForTier(
  bio: string,
  hasPlusAccess: boolean,
  prefs: TravelPreferences,
  defaultBio: string,
): string {
  if (shouldExposePlusPersona(hasPlusAccess, prefs)) return bio;

  const lines = bio
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const filtered = lines.filter((line) => !isPersonaTypeLabel(line));

  if (filtered.length === 0) return defaultBio;
  if (filtered.length === 1 && isPersonaTypeLabel(filtered[0])) return defaultBio;
  return filtered.join("\n");
}

const EMPTY_PERSONA = {
  travelStyle: "",
  personalityType: "",
  personalitySummary: "",
  personalityImpression: "",
} as const;

export function gatePlusPersonaFields(
  profile: UserProfile,
  hasPlusAccess: boolean,
): UserProfile {
  if (shouldExposePlusPersona(hasPlusAccess, profile.prefs)) return profile;
  return { ...profile, ...EMPTY_PERSONA };
}

export function knownPersonaLabels(): readonly string[] {
  return PERSONA_TYPE_LABELS;
}
