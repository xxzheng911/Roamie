import { devVerboseInfo } from "@/lib/dev-verbose-log";
import { settlePlacePhotoRequest } from "@/lib/place-photo-request";
import { resolveSignedPhotoResponse } from "@/lib/place-photo-response";
import { supabase } from "@/integrations/supabase/client";
import { resolveApiUrl } from "@/lib/api-url";
import { extractGooglePlacePhotoName } from "@/lib/safe-image-url";

const cache = new Map<string, { url: string; expiresAt: number }>();
const inflight = new Map<string, Promise<string | null>>();
/** Definite signing failures (http/invalid/timeout/network) → skip re-sign until expiry. Never abort.
 *  http 401/403 與 auth_timeout（登入／session 尚未就緒）不寫入，下次可立即重試。 */
const NEGATIVE_CACHE_TTL_MS = 45_000;
const RATE_LIMIT_TTL_MS = 60_000;
const negativeCache = new Map<string, number>();

type SigningFailureState = {
  signedUrlReturned: boolean;
  timeout: boolean;
  networkReject: boolean;
  httpStatus: number | null;
  fallbackReason: string | null;
};

/** 429：依 Retry-After（秒）取 min(max(值,1),120)，讀不到則 60 秒。 */
function rateLimitTtlMs(retryAfter: string | null): number {
  const seconds = Number(retryAfter);
  if (!retryAfter || !Number.isFinite(seconds)) return RATE_LIMIT_TTL_MS;
  return Math.min(Math.max(seconds, 1), 120) * 1000;
}

/** 回傳負向快取 TTL（毫秒）；不應寫入時回傳 null。 */
function negativeCacheTtlMs(state: SigningFailureState, retryAfter: string | null): number | null {
  if (state.signedUrlReturned) return null;
  if (state.fallbackReason === "auth_timeout") return null;
  const status = state.httpStatus;
  if (state.fallbackReason?.startsWith("http_") && status !== null) {
    if (status === 401 || status === 403) return null;
    return status === 429 ? rateLimitTtlMs(retryAfter) : NEGATIVE_CACHE_TTL_MS;
  }
  const definite =
    state.timeout || state.networkReject || state.fallbackReason === "invalid_signed_response";
  return definite ? NEGATIVE_CACHE_TTL_MS : null;
}

/** Reuse only unexpired URLs from the existing signing authority (including larger covers). */
export function readSignedPlacePhotoUrl(photoOrUrl: string, width: number): string | null {
  const photo = photoOrUrl.startsWith("places/")
    ? photoOrUrl.trim()
    : extractGooglePlacePhotoName(photoOrUrl);
  if (!photo) return null;
  const requested = Math.min(1600, Math.max(120, Math.round(width)));
  const exact = cache.get(`${photo}@${requested}`);
  if (exact && exact.expiresAt > Date.now() + 30_000) return exact.url;
  for (const [key, entry] of cache) {
    if (
      key.startsWith(`${photo}@`) &&
      Number(key.slice(photo.length + 1)) >= requested &&
      entry.expiresAt > Date.now() + 30_000
    )
      return entry.url;
  }
  return null;
}

export async function getSignedPlacePhotoUrl(
  photoOrUrl: string,
  width: number,
  diagnosticContext?: { placeId?: string | null },
): Promise<string | null> {
  const photo = photoOrUrl.startsWith("places/")
    ? photoOrUrl.trim()
    : extractGooglePlacePhotoName(photoOrUrl);
  const normalizedWidth = Math.min(1600, Math.max(120, Math.round(width)));
  const input = {
    placeId: diagnosticContext?.placeId ?? photo?.split("/")[1] ?? null,
    hasPhotoName: Boolean(photo), hasPhotoUrl: !photoOrUrl.startsWith("places/"),
    photoResourceKind: !photo ? "invalid" : photoOrUrl.startsWith("places/") ? "resource" : "url",
    requestedWidth: normalizedWidth,
    pageOriginKind: typeof window !== "undefined" && window.location.origin === "null" ? "opaque" : "nonopaque",
  };
  const fresh = () => ({
    endpointScheme: null as string | null, endpointHost: null as string | null,
    attemptNumber: 0, stage: "metadata", requestStarted: false, requestCompleted: false,
    httpStatus: null as number | null, responseOk: false, responseShapeValid: false,
    authPresent: false, errorClass: null as string | null, timeout: false, abort: false,
    networkReject: false, signedUrlReturned: false,
    imageLoadSucceeded: null, imageLoadFailed: null,
    fallbackReason: null as string | null,
  });
  let state = fresh();
  // Never log the request body, token, response body, URL or exception message.
  const report = () => devVerboseInfo("[PLACE_PHOTO_SIGNING]", { ...input, ...state });
  if (!photo) { state.fallbackReason = "invalid_photo_metadata"; report(); return null; }
  const key = `${photo}@${normalizedWidth}`;
  const existing = readSignedPlacePhotoUrl(photoOrUrl, width);
  if (existing) {
    state.stage = "signed_cache"; state.signedUrlReturned = true; report(); return existing;
  }
  const pending = inflight.get(key);
  if (pending) return pending;
  const negativeUntil = negativeCache.get(key);
  if (negativeUntil !== undefined) {
    if (negativeUntil > Date.now()) {
      state.stage = "negative_cache";
      state.fallbackReason = "negative_cache";
      report();
      return null;
    }
    negativeCache.delete(key);
  }
  let retryAfter: string | null = null;
  const finish = () => {
    inflight.delete(key);
    const ttl = negativeCacheTtlMs(state, retryAfter);
    if (ttl === null) negativeCache.delete(key);
    else negativeCache.set(key, Date.now() + ttl);
  };
  const request = settlePlacePhotoRequest(async (signal, attemptNumber) => {
    state = { ...fresh(), attemptNumber, stage: "auth" };
    report();
    const { data } = await supabase.auth.getSession();
    if (signal.aborted) return null;
    const token = data.session?.access_token;
    state.authPresent = Boolean(token);
    state.stage = "endpoint_resolution";
    const endpoint = resolveApiUrl("/api/place-photo/sign");
    const endpointLocation = new URL(endpoint, window.location.href);
    state.endpointScheme = endpointLocation.protocol.replace(":", "");
    state.endpointHost = endpointLocation.host;
    state.stage = "fetch"; state.requestStarted = true;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(endpoint, {
      method: "POST", signal,
      headers,
      body: JSON.stringify({ photo, width: normalizedWidth }),
    });
    if (signal.aborted) return null;
    state.requestCompleted = true; state.httpStatus = response.status; state.responseOk = response.ok;
    if (!response.ok) { state.fallbackReason = `http_${response.status}`; retryAfter = response.headers.get("Retry-After"); return null; }
    state.stage = "response_parse";
    const body: unknown = await response.json();
    if (signal.aborted) return null;
    state.stage = "signed_url_validation";
    const resolvedUrl = resolveSignedPhotoResponse(body, endpoint, window.location.href);
    state.responseShapeValid = Boolean(resolvedUrl);
    if (!resolvedUrl) { state.fallbackReason = "invalid_signed_response"; return null; }
    const parsed = new URL(resolvedUrl);
    const expires = Number(parsed.searchParams.get("expires"));
    cache.set(key, { url: resolvedUrl, expiresAt: expires * 1000 });
    state.stage = "signed_url"; state.signedUrlReturned = true;
    return resolvedUrl;
  }, 8000, 300, (outcome) => {
    state.timeout = outcome.timeout; state.abort = outcome.abort; state.errorClass = outcome.errorClass;
    state.networkReject = outcome.rejected && state.stage === "fetch" && !outcome.abort;
    if (!state.signedUrlReturned && !state.fallbackReason) state.fallbackReason = outcome.timeout
      ? `${state.stage}_timeout` : state.networkReject ? "fetch_network_rejected"
      : outcome.rejected ? `${state.stage}_exception` : "resolution_unavailable";
    report();
  }).finally(finish);
  inflight.set(key, request);
  return request;
}
