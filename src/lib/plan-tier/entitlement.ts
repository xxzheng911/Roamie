import type { Json } from "@/integrations/supabase/types";

export type PlusEntitlementSource = "app_store" | "admin_grant" | "promo" | "none";

export type PlusEntitlementSnapshot = {
  hasPlus: boolean;
  effectiveSource: PlusEntitlementSource;
  activeSources: PlusEntitlementSource[];
  expiresAt: string | null;
};

export const FREE_PLUS_ENTITLEMENT: PlusEntitlementSnapshot = {
  hasPlus: false,
  effectiveSource: "none",
  activeSources: [],
  expiresAt: null,
};

function isSource(value: unknown): value is PlusEntitlementSource {
  return value === "app_store" || value === "admin_grant" || value === "promo" || value === "none";
}

/** Parse only the authoritative database resolver result. Invalid/missing data fails closed. */
export function parsePlusEntitlementSnapshot(
  value: Json | null | undefined,
): PlusEntitlementSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { ...FREE_PLUS_ENTITLEMENT };
  const row = value as Record<string, Json | undefined>;
  const hasPlus = row.has_plus === true;
  const effectiveSource = isSource(row.effective_source) ? row.effective_source : "none";
  const activeSources = Array.isArray(row.active_sources)
    ? row.active_sources.filter(isSource).filter((source) => source !== "none")
    : [];
  return {
    hasPlus,
    effectiveSource: hasPlus ? effectiveSource : "none",
    activeSources: hasPlus ? activeSources : [],
    expiresAt: typeof row.expires_at === "string" ? row.expires_at : null,
  };
}
