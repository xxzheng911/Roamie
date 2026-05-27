import { isQaBuildEnabled } from "@/lib/qa-auth/build";
import { isQaTestUser } from "@/lib/qa-auth/user";
import type { User } from "@supabase/supabase-js";
import { readDeveloperUnlocked, writeDeveloperUnlocked } from "./storage";

function readDeveloperEmails(): string[] {
  const raw = import.meta.env.VITE_DEVELOPER_EMAILS as string | undefined;
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Internal / QA builds — never enable in App Store production */
export function isDeveloperBuildEnabled(): boolean {
  return (
    import.meta.env.DEV ||
    import.meta.env.VITE_ROAMIE_DEVELOPER === "1" ||
    isQaBuildEnabled()
  );
}

export function isDeveloperEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = readDeveloperEmails();
  if (!list.length) return false;
  return list.includes(email.trim().toLowerCase());
}

export function isDeveloperAccount(
  email: string | null | undefined,
  user?: User | null,
): boolean {
  if (!isDeveloperBuildEnabled()) return false;
  if (user && isQaTestUser(user)) return true;
  if (import.meta.env.VITE_ROAMIE_DEVELOPER === "1") return true;
  if (isDeveloperEmail(email)) return true;
  return readDeveloperUnlocked();
}

export function unlockDeveloperMode(): void {
  if (!isDeveloperBuildEnabled()) return;
  writeDeveloperUnlocked(true);
}

export function lockDeveloperMode(): void {
  writeDeveloperUnlocked(false);
}

export function canShowDeveloperTools(
  email: string | null | undefined,
  user?: User | null,
): boolean {
  return isDeveloperBuildEnabled() && isDeveloperAccount(email, user);
}
