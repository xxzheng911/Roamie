import { createFileRoute } from "@tanstack/react-router";
import {
  getPlaceImageFromCache,
  savePlaceImageToCache,
} from "@/lib/ai/image-cache.server";
import { normalizeCategoryFromPlace } from "@/lib/place-image/place-category";
import { buildPlaceUnsplashQueries } from "@/lib/unsplash/unsplash-queries";
import { searchUnsplashWithQueries } from "@/lib/unsplash/unsplash.server";
import { checkRateLimit } from "@/lib/rate-limit.server";

type Body = {
  cacheKey?: string;
  placeId?: string | null;
  name?: string;
  category?: string;
  city?: string | null;
  country?: string | null;
  primaryType?: string | null;
  types?: string[] | null;
};

export const Route = createFileRoute("/api/place-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = request.headers.get("cf-connecting-ip") ?? "local";
        const limit = checkRateLimit(`place-image:${ip}`, 30, 60_000);
        if (!limit.allowed) {
          return Response.json({ error: "rate_limited" }, { status: 429 });
        }

        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }

        const name = body.name?.trim();
        if (!name) return Response.json({ error: "name_required" }, { status: 400 });

        const cacheKey =
          body.cacheKey?.trim() ||
          (body.placeId?.trim() ? `id:${body.placeId.trim()}` : `name:${name.toLowerCase()}`);

        const cached = await getPlaceImageFromCache(cacheKey);
        if (cached?.image_url) {
          return Response.json({
            url: cached.image_url,
            query: cached.query,
            cacheHit: true,
            source: "unsplash",
            unsplashPhotoId: cached.unsplash_photo_id,
            photographerName: cached.photographer_name,
            photographerUrl: cached.photographer_url,
          });
        }

        try {
          const category =
            body.category?.trim() ||
            normalizeCategoryFromPlace({
              name,
              category: body.category,
              categoryId: body.category,
              primaryType: body.primaryType,
              types: body.types,
            });

          const queries = buildPlaceUnsplashQueries({
            name,
            category,
            city: body.city,
            country: body.country,
            primaryType: body.primaryType,
            types: body.types,
            placeId: body.placeId,
          });

          const hit = await searchUnsplashWithQueries(queries);
          if (!hit) {
            return Response.json({ error: "unsplash_miss" }, { status: 404 });
          }

          const generatedAt = new Date().toISOString();
          await savePlaceImageToCache({
            cache_key: cacheKey,
            place_id: body.placeId?.trim() || null,
            place_name: name,
            query: hit.query,
            image_url: hit.imageUrl,
            photographer_name: hit.photographerName,
            photographer_url: hit.photographerUrl,
            unsplash_photo_id: hit.unsplashPhotoId,
            place_image_source: "unsplash",
            generated_at: generatedAt,
          });

          return Response.json({
            url: hit.imageUrl,
            query: hit.query,
            cacheHit: false,
            source: "unsplash",
            unsplashPhotoId: hit.unsplashPhotoId,
            photographerName: hit.photographerName,
            photographerUrl: hit.photographerUrl,
          });
        } catch (e) {
          console.warn("[place-image] unsplash failed", e);
          return Response.json({ error: "unsplash_failed" }, { status: 502 });
        }
      },
    },
  },
});
