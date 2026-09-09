import { createFileRoute } from "@tanstack/react-router";
import {
  resolveGoogleMapsKeyFromServerEnv,
  type GoogleMapsServerKeySource,
} from "@/lib/google-maps-key-resolve.server";
import { recordPlacesHttpCall } from "@/lib/places-api-stats";
import { checkRateLimit, SECURITY_RATE_LIMITS } from "@/lib/rate-limit.server";
import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";

const MAX_PHOTO_RESOURCE_LENGTH = 2_048;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 8_000;
const GOOGLE_PLACES_ORIGIN = "https://places.googleapis.com";

type PhotoResourceInvalidCategory =
  | "none"
  | "control"
  | "fragment"
  | "path_separator"
  | "query"
  | "structure"
  | "whitespace";

type PhotoResourceValidation = {
  valid: boolean;
  reason:
    | "valid"
    | "too_long"
    | "segment_count"
    | "invalid_prefix"
    | "invalid_photos_segment"
    | "empty_place_id"
    | "empty_photo_reference"
    | "forbidden_character";
  resourceLength: number;
  segmentCount: number;
  placeIdLength: number;
  photoReferenceLength: number;
  firstInvalidCharacterCodePoint: number | null;
  invalidCharacterCategory: PhotoResourceInvalidCategory;
};

type PlacePhotoDependencies = {
  fetch: typeof fetch;
  resolveServerKey: (
    runtimeEnv?: CloudflareRuntimeEnv,
  ) => ReturnType<typeof resolveGoogleMapsKeyFromServerEnv>;
  recordHttpCall: typeof recordPlacesHttpCall;
  timeoutMs: number;
};

const DEFAULT_DEPENDENCIES: PlacePhotoDependencies = {
  fetch: (input, init) => fetch(input, init),
  resolveServerKey: resolveGoogleMapsKeyFromServerEnv,
  recordHttpCall: recordPlacesHttpCall,
  timeoutMs: UPSTREAM_TIMEOUT_MS,
};

type PhotoFailureStage =
  | "key_resolution"
  | "upstream_url_build"
  | "upstream_url_parse"
  | "upstream_fetch_call"
  | "upstream_status"
  | "timeout"
  | "response_read"
  | "response_size"
  | "content_type"
  | "unexpected";

type SafeErrorName = "AbortError" | "TypeError" | "Error" | "unknown";

function safeErrorName(error: unknown): SafeErrorName {
  if (!(error instanceof Error)) return "unknown";
  if (error.name === "AbortError") return "AbortError";
  if (error.name === "TypeError") return "TypeError";
  return "Error";
}

function photoFailureResponse(
  status: number,
  stage: PhotoFailureStage,
  keySource: GoogleMapsServerKeySource,
  options: {
    upstreamStatus?: number;
    error?: unknown;
    upstreamUrlValid?: boolean;
    upstreamPathSegmentCount?: number;
  } = {},
): Response {
  const headers = new Headers({
    "X-Roamie-Photo-Failure-Stage": stage,
    "X-Roamie-Photo-Key-Source": keySource,
  });
  if (options.upstreamStatus !== undefined) {
    headers.set("X-Roamie-Photo-Upstream-Status", String(options.upstreamStatus));
  }
  if (options.error !== undefined) {
    headers.set("X-Roamie-Photo-Error-Name", safeErrorName(options.error));
    if (stage.startsWith("upstream_")) {
      headers.set("X-Roamie-Photo-Upstream-Error-Name", safeErrorName(options.error));
    }
  }
  if (options.upstreamUrlValid !== undefined) {
    headers.set("X-Roamie-Photo-Upstream-Url-Valid", String(options.upstreamUrlValid));
  }
  if (options.upstreamPathSegmentCount !== undefined) {
    headers.set(
      "X-Roamie-Photo-Upstream-Path-Segment-Count",
      String(options.upstreamPathSegmentCount),
    );
  }
  return new Response(null, { status, headers });
}

export function buildPlacePhotoUpstreamPath(photo: string): string {
  return `/v1/${photo}/media`;
}

export function buildPlacePhotoUpstreamUrl(photo: string, maxWidthPx: number, apiKey: string): URL {
  const upstreamUrl = new URL(buildPlacePhotoUpstreamPath(photo), GOOGLE_PLACES_ORIGIN);
  upstreamUrl.searchParams.set("maxWidthPx", String(maxWidthPx));
  upstreamUrl.searchParams.set("key", apiKey);
  return upstreamUrl;
}

export function validatePhotoResource(photo: string): PhotoResourceValidation {
  const segments = photo.split("/");
  const base = {
    resourceLength: photo.length,
    segmentCount: segments.length,
    placeIdLength: segments[1]?.length ?? 0,
    photoReferenceLength: segments[3]?.length ?? 0,
  };
  const invalidCharacter = Array.from(photo).find((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      character === "?" ||
      character === "#" ||
      /\s/u.test(character) ||
      codePoint <= 0x1f ||
      codePoint === 0x7f
    );
  });
  if (invalidCharacter) {
    const codePoint = invalidCharacter.codePointAt(0) ?? null;
    const category: PhotoResourceInvalidCategory =
      invalidCharacter === "?"
        ? "query"
        : invalidCharacter === "#"
          ? "fragment"
          : codePoint !== null && (codePoint <= 0x1f || codePoint === 0x7f)
            ? "control"
            : "whitespace";
    return {
      valid: false,
      reason: "forbidden_character",
      ...base,
      firstInvalidCharacterCodePoint: codePoint,
      invalidCharacterCategory: category,
    };
  }
  if (photo.length > MAX_PHOTO_RESOURCE_LENGTH) {
    return {
      valid: false,
      reason: "too_long",
      ...base,
      firstInvalidCharacterCodePoint: null,
      invalidCharacterCategory: "none",
    };
  }
  if (segments.length !== 4) {
    return {
      valid: false,
      reason: "segment_count",
      ...base,
      firstInvalidCharacterCodePoint: segments.length > 4 ? "/".codePointAt(0)! : null,
      invalidCharacterCategory: segments.length > 4 ? "path_separator" : "structure",
    };
  }
  if (segments[0] !== "places") {
    return {
      valid: false,
      reason: "invalid_prefix",
      ...base,
      firstInvalidCharacterCodePoint: null,
      invalidCharacterCategory: "structure",
    };
  }
  if (!segments[1]) {
    return {
      valid: false,
      reason: "empty_place_id",
      ...base,
      firstInvalidCharacterCodePoint: null,
      invalidCharacterCategory: "structure",
    };
  }
  if (segments[2] !== "photos") {
    return {
      valid: false,
      reason: "invalid_photos_segment",
      ...base,
      firstInvalidCharacterCodePoint: null,
      invalidCharacterCategory: "structure",
    };
  }
  if (!segments[3]) {
    return {
      valid: false,
      reason: "empty_photo_reference",
      ...base,
      firstInvalidCharacterCodePoint: null,
      invalidCharacterCategory: "structure",
    };
  }
  return {
    valid: true,
    reason: "valid",
    ...base,
    firstInvalidCharacterCodePoint: null,
    invalidCharacterCategory: "none",
  };
}

export async function handlePlacePhotoRequest(
  request: Request,
  dependencies: PlacePhotoDependencies = DEFAULT_DEPENDENCIES,
  runtimeEnv?: CloudflareRuntimeEnv,
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

  const validation = photo ? validatePhotoResource(photo) : null;
  if (!validation?.valid) {
    const diagnostic =
      validation ??
      ({
        valid: false,
        reason: "empty_photo_reference",
        resourceLength: 0,
        segmentCount: 0,
        placeIdLength: 0,
        photoReferenceLength: 0,
        firstInvalidCharacterCodePoint: null,
        invalidCharacterCategory: "structure",
      } satisfies PhotoResourceValidation);
    console.warn("[PLACE_PHOTO_RESOURCE_VALIDATION]", diagnostic);
    return new Response("Invalid photo", {
      status: 400,
      headers: { "X-Roamie-Photo-Validation": diagnostic.reason },
    });
  }

  let keySource: GoogleMapsServerKeySource = "none";
  let key: string;
  try {
    const resolution = dependencies.resolveServerKey(runtimeEnv);
    keySource = resolution.source;
    if (!resolution.key) throw new Error("Google Maps server key unavailable");
    key = resolution.key;
  } catch (error) {
    return photoFailureResponse(500, "key_resolution", keySource, { error });
  }

  let upstreamPath: string;
  try {
    upstreamPath = buildPlacePhotoUpstreamPath(photo);
  } catch (error) {
    return photoFailureResponse(500, "upstream_url_build", keySource, {
      error,
      upstreamUrlValid: false,
      upstreamPathSegmentCount: 0,
    });
  }

  let mediaUrl: URL;
  try {
    mediaUrl = new URL(upstreamPath, GOOGLE_PLACES_ORIGIN);
    mediaUrl.searchParams.set("maxWidthPx", String(maxW));
    mediaUrl.searchParams.set("key", key);
  } catch (error) {
    return photoFailureResponse(500, "upstream_url_parse", keySource, {
      error,
      upstreamUrlValid: false,
      upstreamPathSegmentCount: 0,
    });
  }
  const upstreamPathSegmentCount = mediaUrl.pathname.split("/").filter(Boolean).length;

  try {
    dependencies.recordHttpCall("photo", {
      functionName: "place-photo.proxy",
      requestKey: photo,
      caller: "place-photo.proxy",
      screen: "unknown",
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs);
    const fetchUpstream = dependencies.fetch;
    let res: Response;
    try {
      try {
        res = await fetchUpstream(mediaUrl, { redirect: "follow", signal: controller.signal });
      } catch (error) {
        const stage: PhotoFailureStage =
          safeErrorName(error) === "AbortError" ? "timeout" : "upstream_fetch_call";
        return photoFailureResponse(500, stage, keySource, {
          error,
          upstreamUrlValid: true,
          upstreamPathSegmentCount,
        });
      }
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) {
      console.warn("[place-photo] upstream failed", { status: res.status });
      return photoFailureResponse(502, "upstream_status", keySource, {
        upstreamStatus: res.status,
      });
    }
    const declaredLength = Number(res.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_PHOTO_BYTES) {
      return photoFailureResponse(502, "response_size", keySource, {
        upstreamStatus: res.status,
      });
    }
    let body: ArrayBuffer;
    try {
      body = await res.arrayBuffer();
    } catch (error) {
      return photoFailureResponse(502, "response_read", keySource, {
        upstreamStatus: res.status,
        error,
      });
    }
    if (body.byteLength > MAX_PHOTO_BYTES) {
      return photoFailureResponse(502, "response_size", keySource, {
        upstreamStatus: res.status,
      });
    }
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
      return photoFailureResponse(415, "content_type", keySource, {
        upstreamStatus: res.status,
      });
    }
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": contentType.includes("png") ? contentType : "image/jpeg",
        "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    console.error("[place-photo] error", safeErrorName(error));
    return photoFailureResponse(500, "unexpected", keySource, { error });
  }
}

/** Proxy Google Place photos when VITE_GOOGLE_MAPS_API_KEY is absent in native bundle. */
export const Route = createFileRoute("/api/place-photo")({
  server: {
    handlers: {
      GET: async ({ request, context }) =>
        handlePlacePhotoRequest(request, DEFAULT_DEPENDENCIES, context.cloudflareEnv),
    },
  },
});
