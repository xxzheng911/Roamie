import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireAuthenticatedAiRequest } from "@/lib/ai/endpoint-guard.server";
import { signPlacePhoto } from "@/lib/place-photo-signature.server";
import { buildPlacePhotoProxyUrl } from "@/lib/safe-image-url";
import { validatePhotoResource } from "@/routes/api/place-photo";
import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";

const Body = z.object({
  photo: z.string().min(1).max(2048),
  width: z.number().int().min(120).max(1600),
});

export const Route = createFileRoute("/api/place-photo/sign")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        const auth = await requireAuthenticatedAiRequest(request);
        if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
        let body: z.infer<typeof Body>;
        try {
          body = Body.parse(await request.json());
        } catch {
          return Response.json({ error: "invalid_request" }, { status: 400 });
        }
        if (!validatePhotoResource(body.photo).valid)
          return Response.json({ error: "invalid_photo_resource" }, { status: 400 });
        try {
          const runtimeEnv = (context as { cloudflareEnv?: CloudflareRuntimeEnv } | undefined)
            ?.cloudflareEnv;
          const token = await signPlacePhoto(runtimeEnv ?? {}, body.photo, body.width);
          const base = buildPlacePhotoProxyUrl(body.photo, body.width);
          const separator = base.includes("?") ? "&" : "?";
          return Response.json({
            url: `${base}${separator}expires=${token.expires}&signature=${encodeURIComponent(token.signature)}`,
          });
        } catch {
          return Response.json({ error: "photo_signing_unavailable" }, { status: 503 });
        }
      },
    },
  },
});
