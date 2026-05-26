import { readDeveloperUnlocked, writeDeveloperUnlocked } from "./storage";

function readDeveloperEmails(): string[] {
  const raw = import.meta.env.VITE_DEVELOPER_EMAILS as string | undefined;
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Internal builds only — never expose developer UI in production without this flag */
export function isDeveloperBuildEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_ROAMIE_DEVELOPER === "1";
}

export function isDeveloperEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = readDeveloperEmails();
  if (!list.length) return false;
  return list.includes(email.trim().toLowerCase());
}

export function isDeveloperAccount(email: string | null | undefined): boolean {
  if (!isDeveloperBuildEnabled()) return false;
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

export function canShowDeveloperTools(email: string | null | undefined): boolean {
  return isDeveloperBuildEnabled() && isDeveloperAccount(email);
}
