import { newGuardObservation, observeGuardRejection } from "@/lib/abuse-guard-telemetry.server";
import { isAbuseGuardEnforcementOn } from "@/lib/abuse-guard-enforcement.server";
import { checkGoogleProviderRate } from "@/lib/google-rate-limit.server";
import { fixedStatusResponse, isKillSwitchOn } from "@/lib/kill-switch.server";
import { bindVerifiedUserId } from "@/lib/worker-request-scope";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireAuthenticatedAiRequest } from "@/lib/ai/endpoint-guard.server";
import { resolvePublicReadPrincipal } from "@/lib/public-read-auth";
import { signPlacePhoto, sealPlacePhotoPrincipal } from "@/lib/place-photo-signature.server";
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
        const presentedAuth = request.headers.get("authorization");
        let auth: { userId: string } | null = null;
        let guestRateKey: string | null = null;
        if (presentedAuth) {
          try {
            auth = await requireAuthenticatedAiRequest(request);
          } catch {
            return Response.json({ error: "photo_auth_unavailable" }, { status: 503 });
          }
          if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
        } else {
          try {
            const principal = await resolvePublicReadPrincipal(request);
            if (principal.kind !== "guest") return Response.json({ error: "Unauthorized" }, { status: 401 });
            guestRateKey = principal.rateKey;
          } catch {
            return Response.json({ error: "Unauthorized" }, { status: 401 });
          }
        }
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
            observeGuardRejection(newGuardObservation("google", "place_photos"), "kill_switch");
            return fixedStatusResponse("google_unavailable");
          }
          if (auth) bindVerifiedUserId(auth.userId);
          const rateIdentity = auth ? `google:sign:${auth.userId}` : `google:guest-photo:${guestRateKey}`;
          if (!(await checkGoogleProviderRate(runtimeEnv, rateIdentity))) {
            return enforced
              ? fixedStatusResponse("rate_limited", 60)
              : Response.json(
                  { error: "rate_limited" },
                  { status: 429, headers: { "Retry-After": "60" } },
                );
          }
          // Signing is not a Google upstream. Charge the authenticated owner on media fetch.
          const principal = auth ? await sealPlacePhotoPrincipal(runtimeEnv ?? {}, auth.userId) : undefined;
          const token = await signPlacePhoto(
            runtimeEnv ?? {},
            body.photo,
            body.width,
            undefined,
            auth ? "authenticated" : "guest",
            principal,
          );
          const base = buildPlacePhotoProxyUrl(body.photo, body.width);
          const separator = base.includes("?") ? "&" : "?";
          const audience = auth ? `&aud=authenticated&principal=${encodeURIComponent(principal!)}` : "&aud=guest";
          return Response.json({
            url: `${base}${separator}expires=${token.expires}&signature=${encodeURIComponent(token.signature)}${audience}`,
          });
        } catch {
          return Response.json({ error: "photo_signing_unavailable" }, { status: 503 });
        }
      },
    },
  },
});
