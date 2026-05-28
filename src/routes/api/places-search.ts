import { createFileRoute } from "@tanstack/react-router";
import { shouldSkipPlacesClientRetry } from "@/lib/places-api-errors";
import { executeExploreSearch, ExploreSearchInput } from "@/lib/places.functions";
import { getServerCachedExploreSearch } from "@/lib/places-search-server-cache";

const ALLOWED_ORIGINS = new Set([
  "https://roamie.tw",
  "https://www.roamie.tw",
  "capacitor://localhost",
  "ionic://localhost",
  "http://localhost",
  "http://127.0.0.1",
]);

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

export const Route = createFileRoute("/api/places-search")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) =>
        new Response(null, { status: 204, headers: buildCorsHeaders(request) }),
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return jsonResponse(request, { places: [], error: "Invalid JSON" }, 400);
        }

        let data: ReturnType<typeof ExploreSearchInput.parse>;
        try {
          data = ExploreSearchInput.parse(body);
        } catch {
          return jsonResponse(request, { places: [], error: "Invalid request" }, 400);
        }

        try {
          const result = await getServerCachedExploreSearch(
            data,
            () => executeExploreSearch(data),
            (r) => !(r.error && shouldSkipPlacesClientRetry(r.error)),
          );
          return jsonResponse(request, result);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Places search failed";
          console.error("[places-search] error", msg);
          return jsonResponse(request, { places: [], error: msg }, 500);
        }
      },
    },
  },
});
