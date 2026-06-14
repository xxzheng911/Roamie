export type AffiliateEnvConfig = {
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

/** Vite only inlines static import.meta.env.VITE_* keys at build time. */
const AFFILIATE_ENV: AffiliateEnvConfig = {
  tripAccountId: trimEnv(import.meta.env.VITE_TRIP_ACCOUNT_ID),
  tripWebsiteId: trimEnv(import.meta.env.VITE_TRIP_WEBSITE_ID),
  klookAid: trimEnv(import.meta.env.VITE_KLOOK_AID),
  kkdayCid: trimEnv(import.meta.env.VITE_KKDAY_CID),
  agodaAffiliateUrl: trimEnv(import.meta.env.VITE_AGODA_AFFILIATE_URL),
  bookingAid: trimEnv(import.meta.env.VITE_AFFILIATE_BOOKING_AID),
};

function warnMissingEnvOnce(env: AffiliateEnvConfig): void {
  if (!env.agodaAffiliateUrl) {
    warnAffiliateOnce(
      "agoda_missing_env",
      "[Affiliate] Agoda link disabled: missing VITE_AGODA_AFFILIATE_URL",
    );
  }
  if (!env.tripAccountId || !env.tripWebsiteId) {
    warnAffiliateOnce(
      "trip_hotel_missing_env",
      "[Affiliate] Trip.com hotel link disabled: missing VITE_TRIP_ACCOUNT_ID or VITE_TRIP_WEBSITE_ID",
    );
    warnAffiliateOnce(
      "trip_flight_missing_env",
      "[Affiliate] Trip.com flight link disabled: missing VITE_TRIP_ACCOUNT_ID or VITE_TRIP_WEBSITE_ID",
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

// Warn once at module init — never from render / getAffiliateEnv().
warnMissingEnvOnce(AFFILIATE_ENV);

/** Cached affiliate env — read once at module init (Vite inlines import.meta.env at build). */
export function getAffiliateEnv(): Readonly<AffiliateEnvConfig> {
  return AFFILIATE_ENV;
}

/** @deprecated Prefer getAffiliateEnv() */
export function readAffiliateEnv(): AffiliateEnvConfig {
  return { ...AFFILIATE_ENV };
}
