/** Google Places / Maps API 錯誤判斷與 curated fallback */

export function isGoogleBillingDisabledError(error: string | null | undefined): boolean {
  if (!error?.trim()) return false;
  return /BillingNotEnabled|BILLING_NOT_ENABLED|billing.*not enabled|enable billing|帳單.*未|尚未啟用帳單|Google Cloud Project.*billing/i.test(
    error,
  );
}

export function isGooglePlacesIosAppBlockedError(error: string | null | undefined): boolean {
  if (!error?.trim()) return false;
  return /API_KEY_IOS_APP_BLOCKED|iOS client application.*empty|Requests from this iOS client/i.test(
    error,
  );
}

export function isGooglePlacesPermissionError(error: string | null | undefined): boolean {
  if (!error?.trim()) return false;
  if (isGooglePlacesIosAppBlockedError(error)) return true;
  return /403|PERMISSION_DENIED|REQUEST_DENIED|API key not valid|API_KEY_INVALID|API keys? with referer restrictions/i.test(
    error,
  );
}

/** Server / WebView REST 無法使用「僅 iOS App」限制的金鑰；勿再用同一金鑰做 client 重試 */
export function shouldSkipPlacesClientRetry(error: string | null | undefined): boolean {
  if (isGoogleBillingDisabledError(error)) return true;
  return isGooglePlacesPermissionError(error);
}

export function isGooglePlacesQuotaError(error: string | null | undefined): boolean {
  if (!error?.trim()) return false;
  return /429|RESOURCE_EXHAUSTED|Quota exceeded|quota metric/i.test(error);
}

export function isGoogleMapsKeyMissingError(error: string | null | undefined): boolean {
  if (!error?.trim()) return false;
  return /尚未設定|缺少.*API|missing.*key/i.test(error);
}

/** 正式版在 API 權限/金鑰/配額問題時仍顯示 Roamie 預設角落 */
export function shouldUseCuratedPlacesFallback(apiError?: string | null): boolean {
  if (isGoogleBillingDisabledError(apiError)) return true;
  if (isGooglePlacesPermissionError(apiError)) return true;
  if (isGooglePlacesQuotaError(apiError)) return true;
  if (isGoogleMapsKeyMissingError(apiError)) return true;
  return import.meta.env.DEV && !import.meta.env.PROD;
}

export function logPlacesApiResponse(
  status: number,
  error: string | null,
  responseSnippet?: string,
): void {
  console.info("[PLACES_API] status=", status);
  if (error) console.info("[PLACES_API] error=", error);
  if (responseSnippet) {
    console.info("[PLACES_API] response=", responseSnippet.slice(0, 400));
  }
}

export function logPlacesFallbackUsed(reason: string): void {
  console.info("[PLACES_FALLBACK] used=true", reason);
}

/**
 * 探索／首頁 UI 不顯示 API 配額、金鑰等技術訊息；僅在 console 記錄。
 * 有 curated fallback 時讓列表自然呈現即可。
 */
export function placesApiUserHint(_error: string | null | undefined): string | null {
  return null;
}
