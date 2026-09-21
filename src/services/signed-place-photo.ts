import { settlePlacePhotoRequest } from "@/lib/place-photo-request";
import { resolveSignedPhotoResponse } from "@/lib/place-photo-response";
import { supabase } from "@/integrations/supabase/client";
import { resolveApiUrl } from "@/lib/api-url";
import { extractGooglePlacePhotoName } from "@/lib/safe-image-url";

const cache = new Map<string, { url: string; expiresAt: number }>();
const inflight = new Map<string, Promise<string | null>>();

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
  const report = () => console.info("[PLACE_PHOTO_SIGNING]", { ...input, ...state });
  if (!photo) { state.fallbackReason = "invalid_photo_metadata"; report(); return null; }
  const key = `${photo}@${normalizedWidth}`;
  const existing = cache.get(key);
  if (existing && existing.expiresAt > Date.now() + 30_000) {
    state.stage = "signed_cache"; state.signedUrlReturned = true; report(); return existing.url;
  }
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = settlePlacePhotoRequest(async (signal, attemptNumber) => {
    state = { ...fresh(), attemptNumber, stage: "auth" };
    report();
    const { data } = await supabase.auth.getSession();
    if (signal.aborted) return null;
    const token = data.session?.access_token;
    state.authPresent = Boolean(token);
    if (!token) { state.fallbackReason = "auth_session_missing"; return null; }
    state.stage = "endpoint_resolution";
    const endpoint = resolveApiUrl("/api/place-photo/sign");
    const endpointLocation = new URL(endpoint, window.location.href);
    state.endpointScheme = endpointLocation.protocol.replace(":", "");
    state.endpointHost = endpointLocation.host;
    state.stage = "fetch"; state.requestStarted = true;
    const response = await fetch(endpoint, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ photo, width: normalizedWidth }),
    });
    if (signal.aborted) return null;
    state.requestCompleted = true; state.httpStatus = response.status; state.responseOk = response.ok;
    if (!response.ok) { state.fallbackReason = `http_${response.status}`; return null; }
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
  }).finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}
