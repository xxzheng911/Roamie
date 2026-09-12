import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { deleteAuthenticatedAccount } from "@/lib/account-deletion/account-deletion.server";

const Body = z.object({
  requestId: z.string().uuid(),
  apple: z
    .object({
      identityToken: z.string().min(20).max(8_192),
      authorizationCode: z.string().min(4).max(4_096),
    })
    .optional(),
});

const statusFor = (code: string) => {
  if (code === "account_deletion_unauthorized") return 401;
  if (code.includes("recent_auth") || code.includes("identity_mismatch")) return 403;
  if (code.includes("already_in_progress")) return 409;
  if (
    code.includes("configuration_missing") ||
    code.includes("target_invalid") ||
    code.includes("target_not_allowed")
  )
    return 503;
  return 502;
};

export const Route = createFileRoute("/api/account/delete")({
  server: {
    handlers: {
      GET: async () =>
        Response.json(
          { error: "account_deletion_method_not_allowed" },
          { status: 405, headers: { Allow: "POST" } },
        ),
      POST: async ({ request, context }) => {
        let body;
        try {
          body = Body.parse(await request.json());
        } catch {
          return Response.json({ error: "account_deletion_request_invalid" }, { status: 400 });
        }
        try {
          return Response.json(
            await deleteAuthenticatedAccount({ request, runtimeEnv: context.cloudflareEnv, body }),
          );
        } catch (error) {
          const code = error instanceof Error ? error.message : "account_deletion_failed";
          return Response.json({ error: code }, { status: statusFor(code) });
        }
      },
    },
  },
});
