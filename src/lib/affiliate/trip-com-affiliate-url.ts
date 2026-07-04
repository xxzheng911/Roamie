import type { AffiliateEnvConfig } from "@/lib/affiliate/affiliate-env";
import { resolveTripAffiliateBaseUrl } from "@/lib/affiliate/affiliate-env";

export type TripComAffiliateKind = "hotel" | "package";

const TRIP_PATH: Record<TripComAffiliateKind, string> = {
  hotel: "/hotels/list",
  package: "/package-tours/",
};

const PRESERVED_TRACKING_KEYS = ["Allianceid", "SID", "trip_sub3"] as const;

function parseTripAffiliateBase(env: AffiliateEnvConfig): URL | null {
  const raw = resolveTripAffiliateBaseUrl(env);
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** 以 VITE_TRIP_AFFILIATE_URL 為基底組 Trip.com 聯盟連結（保留 Allianceid / SID / trip_sub3） */
export function buildTripComAffiliateUrl(
  env: AffiliateEnvConfig,
  kind: TripComAffiliateKind,
  options?: {
    sub1?: string;
    params?: Record<string, string | undefined>;
  },
): string | null {
  const base = parseTripAffiliateBase(env);
  if (!base) return null;

  const url = new URL(`${base.origin}${TRIP_PATH[kind]}`);

  for (const key of PRESERVED_TRACKING_KEYS) {
    const value = base.searchParams.get(key);
    if (value) url.searchParams.set(key, value);
  }

  const sub1 = options?.sub1?.trim();
  if (sub1) {
    url.searchParams.set("trip_sub1", sub1);
  } else if (base.searchParams.has("trip_sub1")) {
    url.searchParams.set("trip_sub1", base.searchParams.get("trip_sub1") ?? "");
  }

  for (const [key, value] of Object.entries(options?.params ?? {})) {
    if (value != null && value !== "") url.searchParams.set(key, value);
  }

  return url.toString();
}

export function isTripAffiliateConfigured(env: AffiliateEnvConfig): boolean {
  return Boolean(resolveTripAffiliateBaseUrl(env));
}

/** Trip.com 聯盟基底（VITE_TRIP_AFFILIATE_URL 或 ACCOUNT_ID+WEBSITE_ID fallback） */
export function getTripComBaseAffiliateUrl(env: AffiliateEnvConfig): string | null {
  const raw = resolveTripAffiliateBaseUrl(env);
  return raw || null;
}
