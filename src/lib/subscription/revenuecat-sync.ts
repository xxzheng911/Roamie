import { supabase } from "@/lib/supabase";
import { resolveApiUrl } from "@/lib/api-url";

export async function syncRevenueCatEntitlementWithServer(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return false;
  const response = await fetch(resolveApiUrl("/api/subscription/sync"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.ok;
}
