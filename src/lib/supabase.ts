/**
 * 單一瀏覽器 Supabase client 入口（避免多處 createClient 導致 PKCE storage 不一致）
 */
export { supabase } from "@/integrations/supabase/client";
