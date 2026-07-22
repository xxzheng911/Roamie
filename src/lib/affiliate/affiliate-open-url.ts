import { affiliateDebugInfo, affiliateDebugWarn } from "@/lib/affiliate/affiliate-debug-log";

export type AffiliatePlatform = "tripcom_flight" | "agoda_hotel" | "tripcom_hotel" | "other";

export type AffiliateUrlDateParams = {
  departDate?: string;
  returnDate?: string;
  checkIn?: string;
  checkOut?: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function firstIso(values: Array<string | null | undefined>): string | undefined {
  for (const raw of values) {
    const v = raw?.trim();
    if (v && ISO_DATE.test(v)) return v;
  }
  return undefined;
}

/** 依平台解析 URL 中的日期參數（各平台 key 不同） */
export function extractAffiliateDateParams(
  urlString: string,
  platform: AffiliatePlatform,
): AffiliateUrlDateParams {
  try {
    const url = new URL(urlString);
    const p = url.searchParams;

    if (platform === "tripcom_flight") {
      return {
        departDate: firstIso([
          p.get("ddate"),
          p.get("departureDate"),
          p.get("departDate"),
          p.get("depdate"),
        ]),
        returnDate: firstIso([
          p.get("rdate"),
          p.get("returnDate"),
          p.get("adate"),
          p.get("retdate"),
        ]),
      };
    }

    if (platform === "agoda_hotel" || platform === "tripcom_hotel") {
      const checkIn = firstIso([
        p.get("checkIn"),
        p.get("checkin"),
        p.get("checkInDate"),
        p.get("dateIn"),
      ]);
      let checkOut = firstIso([
        p.get("checkOut"),
        p.get("checkout"),
        p.get("checkOutDate"),
        p.get("dateOut"),
      ]);
      if (!checkOut && checkIn) {
        const los = Number(p.get("los"));
        if (Number.isFinite(los) && los > 0) {
          const d = new Date(`${checkIn}T12:00:00`);
          d.setDate(d.getDate() + los);
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, "0");
          const day = String(d.getDate()).padStart(2, "0");
          checkOut = `${y}-${m}-${day}`;
        }
      }
      return { checkIn, checkOut };
    }

    return {};
  } catch {
    return {};
  }
}

function formatDateParamsLog(params: AffiliateUrlDateParams, platform: AffiliatePlatform): string {
  if (platform === "tripcom_flight") {
    return `departDate=${params.departDate ?? ""} returnDate=${params.returnDate ?? ""}`;
  }
  if (platform === "agoda_hotel" || platform === "tripcom_hotel") {
    return `checkIn=${params.checkIn ?? ""} checkOut=${params.checkOut ?? ""}`;
  }
  return "";
}

/** HEAD 追蹤 redirect，記錄 final URL 與日期參數是否保留 */
export async function probeAffiliateRedirectUrl(
  initialUrl: string,
  platform: AffiliatePlatform,
): Promise<{ finalUrl: string; params: AffiliateUrlDateParams; datesPreserved: boolean }> {
  const initialParams = extractAffiliateDateParams(initialUrl, platform);
  affiliateDebugInfo(`[AFFILIATE_OPEN_INITIAL_URL] platform=${platform} url=${initialUrl}`);
  affiliateDebugInfo(
    `[AFFILIATE_PARAMS_AFTER_REDIRECT] stage=initial ${formatDateParamsLog(initialParams, platform)}`,
  );

  let finalUrl = initialUrl;
  try {
    const res = await fetch(initialUrl, {
      method: "HEAD",
      redirect: "follow",
      cache: "no-store",
    });
    if (res.url) finalUrl = res.url;
  } catch (e) {
    affiliateDebugWarn("[AFFILIATE_OPEN] redirect probe failed", e);
  }

  const finalParams = extractAffiliateDateParams(finalUrl, platform);
  affiliateDebugInfo(`[AFFILIATE_OPEN_FINAL_URL] platform=${platform} url=${finalUrl}`);
  affiliateDebugInfo(
    `[AFFILIATE_PARAMS_AFTER_REDIRECT] stage=final ${formatDateParamsLog(finalParams, platform)}`,
  );

  const datesPreserved = affiliateDatesPreserved(initialParams, finalParams, platform);
  if (!datesPreserved) {
    affiliateDebugWarn(
      `[AFFILIATE_OPEN] dates_lost_in_redirect platform=${platform} keeping=${initialUrl}`,
    );
    return { finalUrl: initialUrl, params: initialParams, datesPreserved: false };
  }

  return { finalUrl, params: finalParams, datesPreserved: true };
}

function affiliateDatesPreserved(
  initial: AffiliateUrlDateParams,
  final: AffiliateUrlDateParams,
  platform: AffiliatePlatform,
): boolean {
  if (platform === "tripcom_flight") {
    if (!initial.departDate) return true;
    return initial.departDate === final.departDate;
  }
  if (platform === "agoda_hotel" || platform === "tripcom_hotel") {
    if (!initial.checkIn) return true;
    return initial.checkIn === final.checkIn && initial.checkOut === final.checkOut;
  }
  return true;
}

export function resolveAffiliatePlatform(
  provider?: string,
  type?: string,
): AffiliatePlatform {
  if (provider === "tripcom" && type === "flight") return "tripcom_flight";
  if (provider === "agoda" && type === "hotel") return "agoda_hotel";
  if (provider === "tripcom" && type === "hotel") return "tripcom_hotel";
  return "other";
}
