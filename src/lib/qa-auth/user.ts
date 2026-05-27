import type { User } from "@supabase/supabase-js";
import { QA_USER_METADATA_KEY } from "./constants";

export function isQaTestUser(user: User | null | undefined): boolean {
  if (!user) return false;
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  if (meta?.[QA_USER_METADATA_KEY] === true) return true;
  const email = user.email?.toLowerCase() ?? "";
  return email.endsWith("@qa.internal.roamie.app");
}
