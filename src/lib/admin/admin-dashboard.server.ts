import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  normalizeAdminDashboardData,
  type AdminDashboardData,
  type AdminUserSort,
} from "./admin-analytics";

export async function loadAdminDashboard(params: {
  search?: string;
  sort: AdminUserSort;
  page: number;
  pageSize?: number;
}): Promise<AdminDashboardData> {
  const analyticsClient = supabaseAdmin as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const [{ data, error }, analyticsResult] = await Promise.all([
    supabaseAdmin.rpc("admin_dashboard_phase1", {
      p_search: params.search?.trim() || null,
      p_sort: params.sort,
      p_page: Math.max(1, Math.floor(params.page)),
      p_page_size: Math.min(50, Math.max(1, Math.floor(params.pageSize ?? 50))),
    }),
    analyticsClient.rpc("admin_analytics_v1", { p_period: "30d" }),
  ]);
  if (error) throw new Error(`Admin analytics query failed: ${error.message}`);
  if (analyticsResult.error) {
    console.error("[ADMIN_ANALYTICS_V1] query failed", analyticsResult.error.message);
  }
  const normalized = normalizeAdminDashboardData(
    data,
    analyticsResult.error ? null : analyticsResult.data,
  );
  if (!normalized) throw new Error("Admin analytics response was incomplete");
  return normalized;
}
