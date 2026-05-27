import { createFileRoute } from "@tanstack/react-router";
import { requireGoogleMapsServerKey } from "@/lib/google-maps.server";

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
          if (contentType.toLowerCase().includes("webp")) {
            console.warn("[place-photo] upstream webp rejected for iOS compatibility", photo);
            return new Response(null, { status: 415 });
          }
          const body = await res.arrayBuffer();
          return new Response(body, {
            status: 200,
            headers: {
              "content-type": contentType,
              "cache-control": "public, max-age=86400",
            },
          });
        } catch (e) {
          console.error("[place-photo] error", e);
          return new Response(null, { status: 500 });
        }
      },
    },
  },
});
