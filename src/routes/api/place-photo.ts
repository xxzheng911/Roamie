import { createFileRoute } from "@tanstack/react-router";
import { requireGoogleMapsServerKey } from "@/lib/google-maps.server";

const PHOTO_CACHE_CONTROL = "public, max-age=86400";

/** Cloudflare edge cache（caches.default）；dev / workers.dev 無作用時回傳 null */
function getEdgeCache(): Cache | null {
  const storage = (globalThis as { caches?: CacheStorage & { default?: Cache } }).caches;
  return storage?.default ?? null;
}

/** Proxy Google Place photos when VITE_GOOGLE_MAPS_API_KEY is absent in native bundle. */
export const Route = createFileRoute("/api/place-photo")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const photo = url.searchParams.get("photo")?.trim();
        const maxW = Math.min(1600, Math.max(120, Number(url.searchParams.get("w") ?? 480) || 480));

        if (!photo || !photo.startsWith("places/")) {
          return new Response("Invalid photo", { status: 400 });
        }

        // 只用 photo + w 當 cache key，避免其他 query 參數打散快取
        const cacheKey = new Request(
          `${url.origin}/api/place-photo?photo=${encodeURIComponent(photo)}&w=${maxW}`,
        );
        const edgeCache = getEdgeCache();
        if (edgeCache) {
          try {
            const cached = await edgeCache.match(cacheKey);
            if (cached) return cached;
          } catch (e) {
            console.warn("[place-photo] cache match failed", e);
          }
        }

        try {
          const key = requireGoogleMapsServerKey();
          const mediaUrl = `https://places.googleapis.com/v1/${photo}/media?maxWidthPx=${maxW}&key=${key}`;
          const res = await fetch(mediaUrl, {
            redirect: "follow",
            headers: { Accept: "image/jpeg, image/png, image/*;q=0.8" },
          });
          if (!res.ok) {
            console.warn("[place-photo] upstream failed", res.status, photo);
            return new Response(null, { status: 502 });
          }
          const contentType = res.headers.get("content-type") ?? "image/jpeg";
          const body = await res.arrayBuffer();
          const response = new Response(body, {
            status: 200,
            headers: {
              "content-type": contentType,
              "cache-control": PHOTO_CACHE_CONTROL,
            },
          });
          if (edgeCache) {
            try {
              await edgeCache.put(cacheKey, response.clone());
            } catch (e) {
              console.warn("[place-photo] cache put failed", e);
            }
          }
          return response;
        } catch (e) {
          console.error("[place-photo] error", e);
          return new Response(null, { status: 500 });
        }
      },
    },
  },
});
