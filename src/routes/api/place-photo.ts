import { createFileRoute } from "@tanstack/react-router";
import { requireGoogleMapsServerKey } from "@/lib/google-maps.server";
import { recordPlacesHttpCall } from "@/lib/places-api-stats";

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
          recordPlacesHttpCall("photo", {
            functionName: "place-photo.proxy",
            requestKey: photo,
            caller: "place-photo.proxy",
            screen: "unknown",
          });
          const res = await fetch(mediaUrl, { redirect: "follow" });
          if (!res.ok) {
            console.warn("[place-photo] upstream failed", res.status, photo);
            return new Response(null, { status: 502 });
          }
          const body = await res.arrayBuffer();
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
            console.warn("[place-photo] rejected webp upstream", photo);
            return new Response(null, { status: 415 });
          }
          return new Response(body, {
            status: 200,
            headers: {
              "content-type": contentType.includes("png") ? contentType : "image/jpeg",
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
