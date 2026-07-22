import type { AffiliateEnvConfig } from "@/lib/affiliate/affiliate-env";
import { affiliateDebugInfo } from "@/lib/affiliate/affiliate-debug-log";
import { ensureQueryParam } from "@/lib/affiliate/affiliate-url-utils";
import { normalizeTripComDestination } from "@/lib/affiliate/trip-com-hotel-url";
import type { Locale } from "@/lib/i18n/types";
import type { TripLocation } from "@/lib/location/types";

export type KkdayAffiliateInput = {
  placeName: string;
  destinationLabel?: string;
  destinationLocation?: TripLocation | null;
  locale?: Locale;
  /** 若有明確 KKday 商品 ID，導向商品頁；否則使用搜尋頁 */
  productId?: string;
};

function mapLocaleToKkdayPath(locale?: Locale): string {
  switch (locale) {
    case "en":
      return "en";
    case "ja":
      return "ja";
    case "ko":
      return "ko";
    case "zh-TW":
    default:
      return "zh-tw";
  }
}

function destinationDisplayLabel(input: KkdayAffiliateInput): string {
  return (
    input.destinationLabel?.trim() ||
    input.destinationLocation?.displayLabel?.trim() ||
    input.destinationLocation?.city?.trim() ||
    ""
  );
}

/** 依地點 + 目的地組 KKday 搜尋關鍵字 */
export function buildKkdaySearchKeyword(input: KkdayAffiliateInput): string {
  const placeName = input.placeName.trim();
  const destination = destinationDisplayLabel(input);

  let cityKeyword = input.destinationLocation?.city?.trim() ?? "";
  if (!cityKeyword && destination) {
    const mapped = normalizeTripComDestination(destination);
    cityKeyword = mapped.zhKeyword?.trim() || mapped.keyword?.trim() || "";
  }
  if (!cityKeyword && destination) {
    const parts = destination.split(/[・·/|,，、\s]+/).map((p) => p.trim()).filter(Boolean);
    cityKeyword = parts[parts.length - 1] ?? "";
  }

  if (placeName && cityKeyword) {
    if (placeName.includes(cityKeyword)) return placeName;
    return `${cityKeyword} ${placeName}`.trim();
  }
  if (placeName) return placeName;
  if (cityKeyword) return `${cityKeyword} 票券`;
  return destination;
}

function logKkdayAffiliateBuild(input: {
  placeName: string;
  destination: string;
  keyword: string;
  finalUrl: string;
}): void {
  affiliateDebugInfo(`[KKDAY_AFFILIATE] placeName=${input.placeName}`);
  affiliateDebugInfo(`[KKDAY_AFFILIATE] destination=${input.destination}`);
  affiliateDebugInfo(`[KKDAY_AFFILIATE] keyword=${input.keyword}`);
  affiliateDebugInfo(`[KKDAY_AFFILIATE] finalUrl=${input.finalUrl}`);
}

/** 建立 KKday 聯盟搜尋 / 商品 URL（保留 cid） */
export function buildKkdayAffiliateUrl(
  input: KkdayAffiliateInput,
  env: AffiliateEnvConfig,
): string | null {
  if (!env.kkdayCid) return null;

  const placeName = input.placeName.trim();
  const destination = destinationDisplayLabel(input);
  const localePath = mapLocaleToKkdayPath(input.locale);
  const productId = input.productId?.trim();

  if (productId) {
    const base = `https://www.kkday.com/${localePath}/product/${encodeURIComponent(productId)}`;
    const finalUrl = ensureQueryParam(base, "cid", env.kkdayCid);
    logKkdayAffiliateBuild({
      placeName,
      destination,
      keyword: productId,
      finalUrl,
    });
    return finalUrl;
  }

  const keyword = buildKkdaySearchKeyword(input);
  if (!keyword) return null;

  const base = `https://www.kkday.com/${localePath}/product/productlist`;
  const url = new URL(base);
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("cid", env.kkdayCid);
  const finalUrl = url.toString();
  logKkdayAffiliateBuild({ placeName, destination, keyword, finalUrl });
  return finalUrl;
}

/** @deprecated 點擊 log 已統一由 openAffiliateUrl → [AFFILIATE_CLICK] 輸出 */
export function logKkdayAffiliateOpen(finalUrl: string): void {
  affiliateDebugInfo(`[KKDAY_AFFILIATE] finalUrl=${finalUrl}`);
}
