import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AdminAuthError, requireAdminFromRequest } from "@/lib/admin/admin-auth.server";
import { loadAdminDashboard } from "@/lib/admin/admin-dashboard.server";
import { checkRateLimit, SECURITY_RATE_LIMITS } from "@/lib/rate-limit.server";

const QuerySchema = z.object({
  search: z.string().max(200).optional(),
  sort: z
    .enum(["active_7d", "active_30d", "recently_active", "newest", "oldest"])
    .default("recently_active"),
  page: z.coerce.number().int().min(1).default(1),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const Route = createFileRoute("/api/admin/dashboard")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const admin = await requireAdminFromRequest(request);
          const rate = checkRateLimit(
            `admin:${admin.userId}:minute`,
            SECURITY_RATE_LIMITS.adminPerMinute,
            60_000,
          );
          if (!rate.allowed) return json({ error: "rate_limited" }, 429);
          const url = new URL(request.url);
          const query = QuerySchema.parse({
            search: url.searchParams.get("search") || undefined,
            sort: url.searchParams.get("sort") || undefined,
            page: url.searchParams.get("page") || undefined,
          });
          const dashboard = await loadAdminDashboard(query);
          return json({ dashboard });
        } catch (error) {
          if (error instanceof AdminAuthError) {
            return json({ error: error.message }, error.status);
          }
          if (error instanceof z.ZodError) {
            return json({ error: "Invalid admin dashboard query" }, 400);
          }
          console.error(
            "[ADMIN_DASHBOARD] request failed",
            error instanceof Error ? error.message : "unknown_error",
          );
          return json({ error: "Admin analytics unavailable" }, 500);
        }
      },
    },
  },
});
