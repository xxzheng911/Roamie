import { authorizePlacePhotoSign } from "@/lib/abuse-guard.server";
import { isAbuseGuardEnforcementOn } from "@/lib/abuse-guard-enforcement.server";
import { checkGoogleProviderRate } from "@/lib/google-rate-limit.server";
import { fixedStatusResponse, isKillSwitchOn } from "@/lib/kill-switch.server";
import { bindVerifiedUserId } from "@/lib/worker-request-scope";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireAuthenticatedAiRequest } from "@/lib/ai/endpoint-guard.server";
import { signPlacePhoto } from "@/lib/place-photo-signature.server";
import { buildPlacePhotoProxyUrl } from "@/lib/safe-image-url";
import { validatePhotoResource } from "@/routes/api/place-photo";
import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";
import { readGoogleRequestJson } from "@/lib/google-request-body.server";

const Body = z.object({
  photo: z.string().min(1).max(2048),
  width: z.number().int().min(120).max(1600),
});

export const Route = createFileRoute("/api/place-photo/sign")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        let auth;
        try {
          auth = await requireAuthenticatedAiRequest(request);
        } catch {
          return Response.json({ error: "photo_auth_unavailable" }, { status: 503 });
        }
        if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
        let body: z.infer<typeof Body>;
        try {
          body = Body.parse(await readGoogleRequestJson(request, 8192));
        } catch (error) {
          return Response.json(
            { error: "invalid_request" },
            { status: error instanceof RangeError ? 413 : 400 },
          );
        }
        if (!validatePhotoResource(body.photo).valid)
          return Response.json({ error: "invalid_photo_resource" }, { status: 400 });
        try {
          const runtimeEnv = (context as { cloudflareEnv?: CloudflareRuntimeEnv } | undefined)
            ?.cloudflareEnv;
          const enforced = isAbuseGuardEnforcementOn(runtimeEnv);
          if (enforced && isKillSwitchOn(runtimeEnv, "DISABLE_GOOGLE_PROXY")) {
            return fixedStatusResponse("google_unavailable");
          }
          bindVerifiedUserId(auth.userId);
          if (!(await checkGoogleProviderRate(runtimeEnv, `google:sign:${auth.userId}`))) {
            return enforced
              ? fixedStatusResponse("rate_limited", 60)
              : Response.json(
                  { error: "rate_limited" },
                  { status: 429, headers: { "Retry-After": "60" } },
                );
          }
          if (enforced) {
            const photoGuard = await authorizePlacePhotoSign(body.photo, runtimeEnv, request, auth.userId);
            if (photoGuard) return photoGuard;
          }
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
