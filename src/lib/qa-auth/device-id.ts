import { QA_DEVICE_ID_STORAGE_KEY } from "./constants";

export function getOrCreateQaDeviceId(): string {
  if (typeof window === "undefined") return "server";
  try {
    const existing = localStorage.getItem(QA_DEVICE_ID_STORAGE_KEY);
    if (existing?.trim()) return existing.trim();
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `qa-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(QA_DEVICE_ID_STORAGE_KEY, id);
    return id;
  } catch {
    return `qa-fallback-${Date.now()}`;
  }
}
