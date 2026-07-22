import { isDebugAffiliateEnabled } from "@/lib/affiliate/affiliate-debug-log";

export type AffiliateEnvConfig = {
  tripAffiliateUrl: string;
  tripAccountId: string;
  tripWebsiteId: string;
  klookAid: string;
  kkdayCid: string;
  agodaAffiliateUrl: string;
  bookingAid: string;
};

function getAffiliateWarnedKeys(): Set<string> {
  const globalStore = globalThis as typeof globalThis & {
    __roamieAffiliateWarnedKeys?: Set<string>;
  };
  if (!globalStore.__roamieAffiliateWarnedKeys) {
    globalStore.__roamieAffiliateWarnedKeys = new Set<string>();
  }
  return globalStore.__roamieAffiliateWarnedKeys;
}

export function warnAffiliateOnce(key: string, message: string): void {
  const warnedKeys = getAffiliateWarnedKeys();
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn(message);
}

function trimEnv(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function envKeyPresent(key: string): boolean {
  const raw = import.meta.env[key as keyof ImportMetaEnv];
  return typeof raw === "string" && raw.trim().length > 0;
}

/**
 * Trip.com 聯盟基底 URL：
 * 1. VITE_TRIP_AFFILIATE_URL（完整 tracking link）
 * 2. fallback：VITE_TRIP_ACCOUNT_ID + VITE_TRIP_WEBSITE_ID → tw.trip.com?Allianceid&SID
 */
export function resolveTripAffiliateBaseUrl(env: AffiliateEnvConfig): string {
  const direct = env.tripAffiliateUrl.trim();
  if (direct) return direct;

  const accountId = env.tripAccountId.trim();
  const websiteId = env.tripWebsiteId.trim();
  if (!accountId || !websiteId) return "";

  const url = new URL("https://tw.trip.com/");
  url.searchParams.set("Allianceid", accountId);
  url.searchParams.set("SID", websiteId);
  return url.toString();
}

/** Vite only inlines static import.meta.env.VITE_* keys at build time. */
const AFFILIATE_ENV: AffiliateEnvConfig = {
  tripAffiliateUrl: trimEnv(import.meta.env.VITE_TRIP_AFFILIATE_URL),
  tripAccountId: trimEnv(import.meta.env.VITE_TRIP_ACCOUNT_ID),
  tripWebsiteId: trimEnv(import.meta.env.VITE_TRIP_WEBSITE_ID),
  klookAid: trimEnv(import.meta.env.VITE_KLOOK_AID),
  kkdayCid: trimEnv(import.meta.env.VITE_KKDAY_CID),
  agodaAffiliateUrl: trimEnv(import.meta.env.VITE_AGODA_AFFILIATE_URL),
  bookingAid: trimEnv(import.meta.env.VITE_AFFILIATE_BOOKING_AID),
};

function logAffiliateEnvInit(env: AffiliateEnvConfig): void {
  if (!isDebugAffiliateEnabled()) return;
  const resolvedTripUrl = resolveTripAffiliateBaseUrl(env);
  const rawAffiliateUrlLen =
    typeof import.meta.env.VITE_TRIP_AFFILIATE_URL === "string"
      ? import.meta.env.VITE_TRIP_AFFILIATE_URL.trim().length
      : 0;

  console.info(
    [
      "[Affiliate] init",
      `hasTripAffiliateUrl=${Boolean(resolvedTripUrl)}`,
      `tripUrlLength=${resolvedTripUrl.length}`,
      `tripAffiliateUrlKeyPresent=${envKeyPresent("VITE_TRIP_AFFILIATE_URL")}`,
      `tripAffiliateUrlRawLength=${rawAffiliateUrlLen}`,
      `hasTripAccountId=${Boolean(env.tripAccountId)}`,
      `hasTripWebsiteId=${Boolean(env.tripWebsiteId)}`,
      `tripUrlSource=${env.tripAffiliateUrl ? "VITE_TRIP_AFFILIATE_URL" : resolvedTripUrl ? "account_website_fallback" : "none"}`,
      `hasAgodaUrl=${Boolean(env.agodaAffiliateUrl)}`,
      `hasKlookAid=${Boolean(env.klookAid)}`,
      `hasKkdayCid=${Boolean(env.kkdayCid)}`,
    ].join(" "),
  );
}

function warnMissingEnvOnce(env: AffiliateEnvConfig): void {
  if (!env.agodaAffiliateUrl) {
    warnAffiliateOnce(
      "agoda_missing_env",
      "[Affiliate] Agoda link disabled: missing VITE_AGODA_AFFILIATE_URL",
    );
  }
  if (!resolveTripAffiliateBaseUrl(env)) {
    warnAffiliateOnce(
      "trip_affiliate_missing_env",
      "[Affiliate] Trip.com link disabled: set VITE_TRIP_AFFILIATE_URL or both VITE_TRIP_ACCOUNT_ID + VITE_TRIP_WEBSITE_ID, then npm run build && npx cap sync ios",
    );
  }
  if (!env.klookAid) {
    warnAffiliateOnce(
      "klook_missing_env",
      "[Affiliate] Klook link disabled: missing VITE_KLOOK_AID",
    );
  }
  if (!env.kkdayCid) {
    warnAffiliateOnce(
      "kkday_missing_env",
      "[Affiliate] KKday link disabled: missing VITE_KKDAY_CID",
    );
  }
}

logAffiliateEnvInit(AFFILIATE_ENV);
warnMissingEnvOnce(AFFILIATE_ENV);

/** Cached affiliate env — read once at module init (Vite inlines import.meta.env at build). */
export function getAffiliateEnv(): Readonly<AffiliateEnvConfig> {
  return AFFILIATE_ENV;
}

/** @deprecated Prefer getAffiliateEnv() */
export function readAffiliateEnv(): AffiliateEnvConfig {
  return { ...AFFILIATE_ENV };
}
