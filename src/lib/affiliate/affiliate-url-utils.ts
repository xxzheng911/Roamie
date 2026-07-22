import { isDebugAffiliateEnabled } from "@/lib/affiliate/affiliate-debug-log";

/** 確保 URL 帶有聯盟追蹤 query（已有則不覆寫非空值） */
export function ensureQueryParam(url: string, key: string, value: string): string {
  if (!value) return url;
  try {
    const parsed = new URL(url);
    const existing = parsed.searchParams.get(key);
    if (!existing) parsed.searchParams.set(key, value);
    return parsed.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }
}

export type AffiliateClickLog = {
  provider?: string;
  type?: string;
  destination?: string;
  placeName?: string;
  keyword?: string;
  checkIn?: string;
  checkOut?: string;
  adults?: string | number;
  finalUrl: string;
};

export function logAffiliateClick(input: AffiliateClickLog): void {
  // Click is user-initiated — always keep a single concise line.
  const placePart = input.placeName ? ` placeName=${input.placeName}` : "";
  console.log(
    `[AFFILIATE_CLICK] provider=${input.provider ?? ""} type=${input.type ?? ""}${placePart}`,
  );
  if (isDebugAffiliateEnabled()) {
    console.log(`[AFFILIATE_CLICK_URL] finalUrl=${input.finalUrl}`);
  }
}

export function logAffiliateRender(input: {
  provider: string;
  type: string;
  shouldShow: boolean;
  reason: string;
}): void {
  if (!isDebugAffiliateEnabled()) return;
  console.log(
    `[AFFILIATE_RENDER] provider=${input.provider} type=${input.type} shouldShow=${input.shouldShow ? "true" : "false"} reason=${input.reason}`,
  );
}
