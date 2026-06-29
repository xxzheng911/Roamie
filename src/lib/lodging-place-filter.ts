import type { PlaceResult } from "@/lib/place-result";

export const LODGING_TYPES = new Set([
  "lodging",
  "hotel",
  "motel",
  "hostel",
  "guest_house",
  "resort_hotel",
  "bed_and_breakfast",
  "extended_stay_hotel",
  "private_guest_room",
  "resort",
  "inn",
  "japanese_inn",
  "serviced_apartment",
  "apartment_hotel",
  "aparthotel",
]);

export const LODGING_NAME_RE =
  /飯店|酒店|旅館|旅社|民宿|住宿|宾馆|旅舍|ホテル|旅館|民宿|ペンション|민박|호텔|펜션|Hotel|Hostel|Motel|Resort|Inn\b|Lodging|Accommodation|serviced\s*apartment/i;

export type LodgingPlaceLike = Pick<
  PlaceResult,
  "name" | "primaryType" | "types"
>;

function allTypes(place: LodgingPlaceLike): string[] {
  const out = new Set<string>();
  const primary = (place.primaryType ?? "").trim().toLowerCase();
  if (primary) out.add(primary);
  for (const t of place.types ?? []) {
    const n = (t ?? "").trim().toLowerCase();
    if (n) out.add(n);
  }
  return [...out];
}

/** 使用者明確要求找住宿（允許推薦飯店／旅館） */
export function isExplicitLodgingSearchIntent(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return (
    /(找|搜|搜尋|搜索|推薦|推荐|订|訂|住|附近).{0,16}(住宿|飯店|酒店|旅館|旅社|民宿|hostel|hotel|motel|resort|lodging|accommodation)/i.test(
      t,
    ) ||
    /(住宿|飯店|酒店|旅館|旅社|民宿|hostel|hotel|motel|resort).{0,16}(找|推薦|推荐|附近|哪|有)/i.test(
      t,
    )
  );
}

export function isLodgingPlace(
  place: LodgingPlaceLike,
  options?: { allowLodging?: boolean },
): boolean {
  if (options?.allowLodging) return false;
  const name = (place.name ?? "").trim();
  if (name && LODGING_NAME_RE.test(name)) return true;
  return allTypes(place).some((t) => LODGING_TYPES.has(t));
}

export function filterNonLodgingPlaces<T extends LodgingPlaceLike>(
  places: T[],
  options?: { allowLodging?: boolean },
): T[] {
  if (options?.allowLodging) return places;
  return places.filter((place) => !isLodgingPlace(place));
}
