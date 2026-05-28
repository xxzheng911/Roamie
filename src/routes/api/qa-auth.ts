import { createFileRoute } from "@tanstack/react-router";
import {
  createQaAuthSession,
  isQaAuthEnabledOnServer,
  qaEmailForDevice,
} from "@/lib/qa-auth/server";
import { QA_CLIENT_BUILD_HEADER } from "@/lib/qa-auth/constants";

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
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": `Content-Type, ${QA_CLIENT_BUILD_HEADER}`,
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

function withQaEnabled(body: Record<string, unknown>) {
  return {
    ...body,
    qa_auth_enabled: isQaAuthEnabledOnServer(),
  };
}

function isAllowedOrigin(request: Request): boolean {
  const origin = resolveRequestOrigin(request);
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin);
}

export const Route = createFileRoute("/api/qa-auth")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isQaAuthEnabledOnServer()) {
          return jsonResponse(request, withQaEnabled({ error: "Not found" }), 404);
        }

        if (!isAllowedOrigin(request)) {
          return jsonResponse(request, withQaEnabled({ error: "Forbidden" }), 403);
        }

        if (request.headers.get(QA_CLIENT_BUILD_HEADER) !== "1") {
          return jsonResponse(request, withQaEnabled({ error: "Forbidden" }), 403);
        }

        let body: { deviceId?: string };
        try {
          body = (await request.json()) as { deviceId?: string };
        } catch {
          return jsonResponse(request, withQaEnabled({ error: "Invalid request" }), 400);
        }

        const deviceId = body.deviceId?.trim();
        if (!deviceId || deviceId.length > 128) {
          return jsonResponse(request, withQaEnabled({ error: "Invalid deviceId" }), 400);
        }

        try {
          const session = await createQaAuthSession(deviceId);
          return jsonResponse(request, {
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            expires_in: session.expires_in,
            token_type: session.token_type,
            user: session.user,
            email: qaEmailForDevice(deviceId),
            qa_auth_enabled: true,
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : "QA auth failed";
          console.error("[qa-auth]", message);
          return jsonResponse(request, withQaEnabled({ error: message }), 500);
        }
      },
      GET: async ({ request }) =>
        jsonResponse(request, {
          enabled: isQaAuthEnabledOnServer(),
          endpoint: "/api/qa-auth",
        }),
      OPTIONS: async ({ request }) =>
        new Response(null, {
          status: 204,
          headers: buildCorsHeaders(request),
        }),
    },
  },
});
