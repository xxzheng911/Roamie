import type { PlaceResult } from "@/lib/place-result";
import { normalizePlaceName } from "@/lib/place-planning-memory";

export function logAiNormalizedPlacesCount(count: number): void {
  console.info("[AI_NORMALIZED_PLACES_COUNT]", `count=${count}`);
}

export function logAiResolvedPlacesCount(count: number): void {
  console.info("[AI_RESOLVED_PLACES_COUNT]", `count=${count}`);
}

export function logAiBuildDayPlanStart(days: number, places: number): void {
  console.info("[AI_BUILD_DAY_PLAN_START]", `days=${days}`, `places=${places}`);
}

export function logAiDayPlanItemAdded(day: number, name: string, type: string): void {
  if (!import.meta.env.DEV) return;
  console.info(
    "[AI_DAY_PLAN_ITEM_ADDED]",
    `day=${day}`,
    `name=${name}`,
    `type=${type}`,
  );
}

export function logAiDayPlanFinalSummary(days: number, totalItems: number): void {
  console.info("[AI_DAY_PLAN_FINAL]", `days=${days}`, `totalItems=${totalItems}`);
}

export function logAiRenderItineraryStart(): void {
  console.info("[AI_RENDER_ITINERARY_START]");
}

export function logAiRenderItinerarySuccess(itemCount: number): void {
  console.info("[AI_RENDER_ITINERARY_SUCCESS]", `itemCount=${itemCount}`);
}

export function logAiRenderBlocked(
  reason: string,
  places: number,
  dayPlanItems: number,
  sessionId?: string,
  currentSessionId?: string,
): void {
  console.warn(
    "[AI_RENDER_BLOCKED]",
    `reason=${reason}`,
    `places=${places}`,
    `dayPlan=${dayPlanItems}`,
    sessionId ? `sessionId=${sessionId}` : "",
    currentSessionId ? `current=${currentSessionId}` : "",
  );
}

function inferBasicType(name: string, types?: string[]): string {
  const blob = `${name} ${(types ?? []).join(" ")}`.toLowerCase();
  if (/博物|museum/i.test(blob)) return "museum";
  if (/美術|gallery/i.test(blob)) return "art_gallery";
  if (/咖啡|cafe|coffee/i.test(blob)) return "cafe";
  if (/餐|restaurant|food|小吃/i.test(blob)) return "restaurant";
  if (/公園|park|自然|步道|海/i.test(blob)) return "park";
  if (/夜市|market/i.test(blob)) return "market";
  if (/商圈|shopping/i.test(blob)) return "shopping_mall";
  return types?.[0]?.trim() || "tourist_attraction";
}

/** 規劃用地點：name + type 即可；缺 id / photo / rating 不丟棄 */
export function normalizePlanningPlaces(places: PlaceResult[]): PlaceResult[] {
  const seen = new Set<string>();
  const out: PlaceResult[] = [];

  for (const place of places) {
    const name = place.name?.trim();
    if (!name) continue;

    const nameKey = normalizePlaceName(name);
    let id = (place.id ?? (place as PlaceResult & { placeId?: string }).placeId ?? "").trim();
    if (!id) {
      id = `synthetic:${nameKey || name}`;
    }

    const dedupeKey = id.startsWith("synthetic:") ? nameKey || name : id;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const primaryType = place.primaryType?.trim() || inferBasicType(name, place.types);

    out.push({
      ...place,
      id,
      name,
      primaryType,
      types: place.types?.length ? place.types : [primaryType],
    });
  }

  logAiNormalizedPlacesCount(out.length);
  return out;
}
