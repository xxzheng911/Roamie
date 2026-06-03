export {
  getSupabaseEnvCheckSnapshot,
  isSupabaseViteEnvValid as isSupabaseEnvValidForClient,
  logSupabaseEnvCheck,
  normalizeSupabaseProjectUrl,
  readViteSupabaseAnonKey,
  readViteSupabaseUrl,
} from "@/lib/vite-supabase-env";

import {
  readViteSupabaseAnonKey,
  readViteSupabaseUrl,
} from "@/lib/vite-supabase-env";

export function readSupabaseEnvForClient(): { url?: string; key?: string } {
  return {
    url: readViteSupabaseUrl(),
    key: readViteSupabaseAnonKey(),
  };
}
