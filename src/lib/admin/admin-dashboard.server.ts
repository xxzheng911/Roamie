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
  const { data, error } = await supabaseAdmin.rpc("admin_dashboard_phase1", {
    p_search: params.search?.trim() || null,
    p_sort: params.sort,
    p_page: Math.max(1, Math.floor(params.page)),
    p_page_size: Math.min(50, Math.max(1, Math.floor(params.pageSize ?? 50))),
  });
  if (error) throw new Error(`Admin analytics query failed: ${error.message}`);
  const normalized = normalizeAdminDashboardData(data);
  if (!normalized) throw new Error("Admin analytics response was incomplete");
  return normalized;
}
