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
  if (readDeveloperUnlocked()) return true;
  if (!isDeveloperBuildEnabled()) return false;
  if (user && isQaTestUser(user)) return true;
  if (import.meta.env.VITE_ROAMIE_DEVELOPER === "1") return true;
  if (isDeveloperEmail(email)) return true;
  return false;
}

/** 使用者手動解鎖 Developer Mode（設定 → 關於 Roamie → 版本號 ×7） */
export function unlockDeveloperMode(): void {
  writeDeveloperUnlocked(true);
}

export function lockDeveloperMode(): void {
  writeDeveloperUnlocked(false);
}

/** Developer Center / QA UI 是否可見（預設關閉，僅手動解鎖後顯示） */
export function isDeveloperModeUnlocked(): boolean {
  return readDeveloperUnlocked();
}

export function canShowDeveloperTools(
  _email: string | null | undefined,
  _user?: User | null,
): boolean {
  return readDeveloperUnlocked();
}
