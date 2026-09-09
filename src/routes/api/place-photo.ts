import { createFileRoute } from "@tanstack/react-router";
import { requireGoogleMapsServerKey } from "@/lib/google-maps.server";
import { recordPlacesHttpCall } from "@/lib/places-api-stats";
import { checkRateLimit, SECURITY_RATE_LIMITS } from "@/lib/rate-limit.server";

const PHOTO_RESOURCE = /^places\/[^/?#\s]+\/photos\/[^/?#\s]+$/;
const MAX_PHOTO_RESOURCE_LENGTH = 2_048;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 8_000;

type PlacePhotoDependencies = {
  fetch: typeof fetch;
  requireServerKey: typeof requireGoogleMapsServerKey;
  recordHttpCall: typeof recordPlacesHttpCall;
  timeoutMs: number;
};

const DEFAULT_DEPENDENCIES: PlacePhotoDependencies = {
  fetch,
  requireServerKey: requireGoogleMapsServerKey,
  recordHttpCall: recordPlacesHttpCall,
  timeoutMs: UPSTREAM_TIMEOUT_MS,
};

function isValidPhotoResource(photo: string): boolean {
  if (photo.length > MAX_PHOTO_RESOURCE_LENGTH || !PHOTO_RESOURCE.test(photo)) return false;
  return !Array.from(photo).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

export async function handlePlacePhotoRequest(
  request: Request,
  dependencies: PlacePhotoDependencies = DEFAULT_DEPENDENCIES,
): Promise<Response> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const rate = checkRateLimit(`photo:${ip}:minute`, SECURITY_RATE_LIMITS.photoPerMinute, 60_000);
  if (!rate.allowed)
    return new Response(null, {
      status: 429,
      headers: { "Retry-After": String(rate.retryAfterSec) },
    });
  const url = new URL(request.url);
  const photo = url.searchParams.get("photo");
  const maxW = Math.min(1600, Math.max(120, Number(url.searchParams.get("w") ?? 480) || 480));

  if (!photo || !isValidPhotoResource(photo)) {
    return new Response("Invalid photo", { status: 400 });
  }

  try {
    const key = dependencies.requireServerKey();
    const mediaUrl = `https://places.googleapis.com/v1/${photo}/media?maxWidthPx=${maxW}&key=${key}`;
    dependencies.recordHttpCall("photo", {
      functionName: "place-photo.proxy",
      requestKey: photo,
      caller: "place-photo.proxy",
      screen: "unknown",
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs);
    let res: Response;
    try {
      res = await dependencies.fetch(mediaUrl, { redirect: "follow", signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) {
      console.warn("[place-photo] upstream failed", { status: res.status });
      return new Response(null, { status: 502 });
    }
    const declaredLength = Number(res.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_PHOTO_BYTES) return new Response(null, { status: 502 });
    const body = await res.arrayBuffer();
    if (body.byteLength > MAX_PHOTO_BYTES) return new Response(null, { status: 502 });
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const isWebpBody =
      body.byteLength >= 12 &&
      (() => {
        const bytes = new Uint8Array(body, 0, 12);
        return (
          bytes[0] === 0x52 &&
          bytes[1] === 0x49 &&
          bytes[2] === 0x46 &&
          bytes[3] === 0x46 &&
          bytes[8] === 0x57 &&
          bytes[9] === 0x45 &&
          bytes[10] === 0x42 &&
          bytes[11] === 0x50
        );
      })();
    if (contentType.includes("webp") || isWebpBody) {
      console.warn("[place-photo] rejected webp upstream");
      return new Response(null, { status: 415 });
    }
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": contentType.includes("png") ? contentType : "image/jpeg",
        "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      },
    });
  } catch (e) {
    console.error("[place-photo] error", e instanceof Error ? e.name : "unknown_error");
    return new Response(null, { status: 500 });
  }
}

/** Proxy Google Place photos when VITE_GOOGLE_MAPS_API_KEY is absent in native bundle. */
export const Route = createFileRoute("/api/place-photo")({
  server: {
    handlers: {
      GET: async ({ request }) => handlePlacePhotoRequest(request),
    },
  },
});
