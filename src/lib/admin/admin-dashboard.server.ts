import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  normalizeAdminAnalyticsV1,
  normalizeAdminDashboardData,
  type AdminAnalyticsV1,
  type AdminDashboardData,
  type AdminUserSort,
} from "./admin-analytics";

export type AdminAnalyticsPeriod = AdminAnalyticsV1["period"];

const analyticsClient = supabaseAdmin as unknown as {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

/** 只查分析區（admin_analytics_v1）；查詢失敗時回傳 null，與整頁載入時的行為一致 */
export async function loadAdminAnalytics(
  period: AdminAnalyticsPeriod,
): Promise<AdminAnalyticsV1 | null> {
  const { data, error } = await analyticsClient.rpc("admin_analytics_v1", { p_period: period });
  if (error) {
    console.error("[ADMIN_ANALYTICS_V1] query failed", error.message);
    return null;
  }
  return normalizeAdminAnalyticsV1(data);
}

export async function loadAdminDashboard(params: {
  search?: string;
  sort: AdminUserSort;
  page: number;
  pageSize?: number;
  period?: AdminAnalyticsPeriod;
}): Promise<AdminDashboardData> {
  const [{ data, error }, analyticsResult] = await Promise.all([
    supabaseAdmin.rpc("admin_dashboard_phase1", {
      p_search: params.search?.trim() || null,
      p_sort: params.sort,
      p_page: Math.max(1, Math.floor(params.page)),
      p_page_size: Math.min(50, Math.max(1, Math.floor(params.pageSize ?? 50))),
    }),
    analyticsClient.rpc("admin_analytics_v1", { p_period: params.period ?? "30d" }),
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
