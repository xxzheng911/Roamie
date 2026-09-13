export type HomePersonalizationVariant = "skeleton" | "plus" | "free";

export function resolveHomePersonalizationVariant(
  entitlementDisplayStable: boolean,
  hasPlusAccess: boolean,
): HomePersonalizationVariant {
  if (!entitlementDisplayStable) return "skeleton";
  return hasPlusAccess ? "plus" : "free";
}
