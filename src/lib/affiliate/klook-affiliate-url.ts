import type { AffiliateEnvConfig } from "@/lib/affiliate/affiliate-env";
import { ensureQueryParam } from "@/lib/affiliate/affiliate-url-utils";
import type { Locale } from "@/lib/i18n/types";

function mapLocaleToKlookPath(locale?: Locale): string {
  switch (locale) {
    case "en":
      return "en";
    case "ja":
      return "ja";
    case "ko":
      return "ko";
    case "zh-TW":
    default:
      return "zh-TW";
  }
}

/** 建立 Klook 聯盟搜尋 URL（query 經 URLSearchParams encode，aid 以 query 附加） */
export function buildKlookAffiliateUrl(
  query: string,
  env: AffiliateEnvConfig,
  locale?: Locale,
): string | null {
  if (!env.klookAid) return null;
  const q = query.trim();
  if (!q) return null;

  const localePath = mapLocaleToKlookPath(locale);
  const url = new URL(`https://www.klook.com/${localePath}/search/`);
  url.searchParams.set("query", q);
  const finalUrl = ensureQueryParam(url.toString(), "aid", env.klookAid);
  return finalUrl;
}
