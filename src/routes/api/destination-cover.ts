import { createFileRoute } from "@tanstack/react-router";
import {
  getDestinationCoverFromCache,
  saveDestinationCoverToCache,
} from "@/lib/ai/image-cache.server";
import { normalizeDestinationKey } from "@/lib/destination/normalize-destination-key";
import { buildTripCoverQueries } from "@/lib/unsplash/unsplash-queries";
import { searchUnsplashWithQueries } from "@/lib/unsplash/unsplash.server";
import { checkRateLimit } from "@/lib/rate-limit.server";

type Body = {
  destinationName?: string;
  normalizedDestinationKey?: string;
  city?: string | null;
  country?: string | null;
  mood?: string | null;
  moodTag?: string | null;
  title?: string | null;
};

export const Route = createFileRoute("/api/destination-cover")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = request.headers.get("cf-connecting-ip") ?? "local";
        const limit = checkRateLimit(`destination-cover:${ip}`, 20, 60_000);
        if (!limit.allowed) {
          return Response.json({ error: "rate_limited" }, { status: 429 });
        }

        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }

        const destinationName = body.destinationName?.trim();
        if (!destinationName) {
          return Response.json({ error: "destination_required" }, { status: 400 });
        }

        const normalizedKey =
          body.normalizedDestinationKey?.trim() ||
          normalizeDestinationKey(destinationName);

        const cached = await getDestinationCoverFromCache(normalizedKey);
        if (cached?.image_url) {
          return Response.json({
            url: cached.image_url,
            query: cached.query,
            normalizedDestinationKey: normalizedKey,
            cacheHit: true,
            source: "unsplash",
            unsplashPhotoId: cached.unsplash_photo_id,
            photographerName: cached.photographer_name,
            photographerUrl: cached.photographer_url,
          });
        }

        try {
          const queries = buildTripCoverQueries({
            destination: destinationName,
            city: body.city,
            country: body.country,
            mood: body.mood,
            moodTag: body.moodTag,
            title: body.title,
          });
          const hit = await searchUnsplashWithQueries(queries);
          if (!hit) {
            return Response.json({ error: "unsplash_miss" }, { status: 404 });
          }

          const generatedAt = new Date().toISOString();
          await saveDestinationCoverToCache({
            normalized_destination_key: normalizedKey,
            destination_name: destinationName,
            query: hit.query,
            image_url: hit.imageUrl,
            photographer_name: hit.photographerName,
            photographer_url: hit.photographerUrl,
            unsplash_photo_id: hit.unsplashPhotoId,
            generated_at: generatedAt,
            source: "unsplash",
          });

          return Response.json({
            url: hit.imageUrl,
            query: hit.query,
            normalizedDestinationKey: normalizedKey,
            cacheHit: false,
            source: "unsplash",
            unsplashPhotoId: hit.unsplashPhotoId,
            photographerName: hit.photographerName,
            photographerUrl: hit.photographerUrl,
          });
        } catch (e) {
          console.warn("[destination-cover] unsplash failed", e);
          return Response.json({ error: "unsplash_failed" }, { status: 502 });
        }
      },
    },
  },
});
