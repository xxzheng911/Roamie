import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  fetchPlaceDetailsForScreen,
  type PlaceDetailsScreenResult,
} from "@/lib/places.functions";
import { getServerCachedPlaceDetailsScreen } from "@/lib/places-details-server-cache";
import { coerceLocale } from "@/lib/i18n/resolve-locale";

const ALLOWED_ORIGINS = new Set([
  "https://roamie.tw",
  "https://www.roamie.tw",
  "capacitor://localhost",
  "ionic://localhost",
  "http://localhost",
  "http://127.0.0.1",
]);

const PlaceDetailsBody = z.object({
  placeId: z.string().min(1),
  locale: z.enum(["zh-TW", "en", "ja", "ko"]).optional(),
});

function resolveRequestOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (origin?.trim()) return origin.trim();
  const referer = request.headers.get("referer");
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function buildCorsHeaders(request: Request): HeadersInit {
  const origin = resolveRequestOrigin(request);
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://roamie.tw";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function jsonResponse(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...buildCorsHeaders(request),
    },
  });
}

export const Route = createFileRoute("/api/place-details")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) =>
        new Response(null, { status: 204, headers: buildCorsHeaders(request) }),
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return jsonResponse(request, { place: null, error: "Invalid JSON" }, 400);
        }

        let data: z.infer<typeof PlaceDetailsBody>;
        try {
          data = PlaceDetailsBody.parse(body);
        } catch {
          return jsonResponse(request, { place: null, error: "Invalid request" }, 400);
        }

        const id = data.placeId.trim();
        if (
          id.startsWith("latlng:") ||
          id.startsWith("saved-") ||
          id.startsWith("temp:") ||
          id.startsWith("mock-")
        ) {
          return jsonResponse(request, { place: null, error: "synthetic_id" });
        }

        try {
          const locale = coerceLocale(data.locale);
          const place: PlaceDetailsScreenResult | null = await getServerCachedPlaceDetailsScreen(
            id,
            locale,
            () => fetchPlaceDetailsForScreen(id, locale),
          );
          if (!place) {
            return jsonResponse(request, { place: null, error: "place_not_found" });
          }
          return jsonResponse(request, { place, error: null });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "place_details_failed";
          console.error("[place-details] error", msg);
          return jsonResponse(request, { place: null, error: msg }, 500);
        }
      },
    },
  },
});
