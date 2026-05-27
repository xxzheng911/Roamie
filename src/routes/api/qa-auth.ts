import { createFileRoute } from "@tanstack/react-router";
import {
  createQaAuthSession,
  isQaAuthEnabledOnServer,
  qaEmailForDevice,
} from "@/lib/qa-auth/server";
import { QA_CLIENT_BUILD_HEADER } from "@/lib/qa-auth/constants";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin") ?? request.headers.get("referer");
  if (!origin) return true;
  try {
    return new URL(request.url).host === new URL(origin).host;
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/qa-auth")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isQaAuthEnabledOnServer()) {
          return jsonResponse({ error: "Not found" }, 404);
        }

        if (!isAllowedOrigin(request)) {
          return jsonResponse({ error: "Forbidden" }, 403);
        }

        if (request.headers.get(QA_CLIENT_BUILD_HEADER) !== "1") {
          return jsonResponse({ error: "Forbidden" }, 403);
        }

        let body: { deviceId?: string };
        try {
          body = (await request.json()) as { deviceId?: string };
        } catch {
          return jsonResponse({ error: "Invalid request" }, 400);
        }

        const deviceId = body.deviceId?.trim();
        if (!deviceId || deviceId.length > 128) {
          return jsonResponse({ error: "Invalid deviceId" }, 400);
        }

        try {
          const session = await createQaAuthSession(deviceId);
          return jsonResponse({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            expires_in: session.expires_in,
            token_type: session.token_type,
            user: session.user,
            email: qaEmailForDevice(deviceId),
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : "QA auth failed";
          console.error("[qa-auth]", message);
          return jsonResponse({ error: message }, 500);
        }
      },
    },
  },
});
