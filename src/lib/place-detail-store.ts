import type { PlaceDetailHandoff } from "@/lib/place-detail-handoff";

const STORE_KEY = "roamie:place-detail-store";

export function isTemporaryPlaceId(placeId: string): boolean {
  return placeId.trim().startsWith("temp:");
}

function readStore(): Record<string, PlaceDetailHandoff> {
  if (typeof sessionStorage === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PlaceDetailHandoff>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, PlaceDetailHandoff>): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (e) {
    console.warn("[PLACE_STORE] write failed", e);
  }
}

export function setPlaceDetailStoreEntry(placeId: string, handoff: PlaceDetailHandoff): void {
  const id = placeId.trim();
  if (!id) return;
  const store = readStore();
  store[id] = { ...handoff, placeId: id };
  writeStore(store);
  console.info("[PLACE_STORE] saved placeId=", id);
}

export function peekPlaceDetailStore(placeId: string): PlaceDetailHandoff | null {
  const id = placeId.trim();
  if (!id) return null;
  const entry = readStore()[id];
  if (!entry?.name) return null;
  return { ...entry, placeId: id };
}

export function createTemporaryPlaceId(): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}`;
  return `temp:${suffix}`;
}
