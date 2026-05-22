import { distanceMeters } from "@/lib/map-explore";
import type { RoamieLocation } from "@/lib/ai/context";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import type { ChatPlaceItem, ChatPlanningSession } from "@/lib/chat-session";
import { placeDisplayName, roamieRecToChatItem } from "@/lib/chat-session";

export type PlaceLike = {
  name: string;
  placeName?: string;
  placeId?: string;
  address?: string;
  type?: string;
  lat?: number | null;
  lng?: number | null;
};

/** 正規化名稱：去空白、全半形、常見尾綴 */
export function normalizePlaceName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[（(].*[)）]/g, "")
    .replace(/店$|館$|廳$/, "");
}

function normalizeAddress(address?: string): string {
  if (!address?.trim()) return "";
  return address.trim().toLowerCase().replace(/\s+/g, "");
}

/** 穩定 id：placeId > name+address */
export function placeIdentityKey(p: PlaceLike): string {
  if (p.placeId?.trim()) return `id:${p.placeId.trim()}`;
  const name = normalizePlaceName(p.placeName ?? p.name);
  const addr = normalizeAddress(p.address);
  return addr ? `na:${name}@${addr}` : `n:${name}`;
}

/** 名稱高度相似（子字串或編輯距離簡化） */
export function isSimilarPlaceName(a: string, b: string): boolean {
  const na = normalizePlaceName(a);
  const nb = normalizePlaceName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 3 && nb.length >= 3 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

export function isDuplicatePlace(a: PlaceLike, b: PlaceLike): boolean {
  if (placeIdentityKey(a) === placeIdentityKey(b)) return true;
  const nameA = placeDisplayName(a as RoamieRecommendationItem);
  const nameB = placeDisplayName(b as RoamieRecommendationItem);
  if (isSimilarPlaceName(nameA, nameB)) return true;
  const addrA = normalizeAddress(a.address);
  const addrB = normalizeAddress(b.address);
  if (addrA && addrB && addrA === addrB) return true;
  return false;
}

/** 依 placeIdentityKey 去重，保留先出現者 */
export function dedupePlaces<T extends PlaceLike>(places: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of places) {
    const key = placeIdentityKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

export function filterAlreadySelectedPlaces<T extends PlaceLike>(
  candidates: T[],
  selected: PlaceLike[],
): T[] {
  if (!selected.length) return dedupePlaces(candidates);
  return dedupePlaces(candidates).filter(
    (c) => !selected.some((s) => isDuplicatePlace(c, s)),
  );
}

export function filterAlreadyRecommendedPlaces<T extends PlaceLike>(
  candidates: T[],
  opts: {
    selected?: PlaceLike[];
    recommended?: PlaceLike[];
    rejectedNames?: string[];
    recentNames?: string[];
  },
): T[] {
  let list = dedupePlaces(candidates);
  const block: PlaceLike[] = [
    ...(opts.selected ?? []),
    ...(opts.recommended ?? []),
    ...(opts.rejectedNames ?? []).map((name) => ({ name })),
    ...(opts.recentNames ?? []).map((name) => ({ name })),
  ];
  if (block.length) list = filterAlreadySelectedPlaces(list, block);
  return list;
}

/** 依與已選地點的距離排序（近的先） */
export function sortByProximityToAnchors<T extends PlaceLike>(
  candidates: T[],
  anchors: PlaceLike[],
): T[] {
  const withCoords = anchors.filter((a) => a.lat != null && a.lng != null);
  if (!withCoords.length) return candidates;
  return [...candidates].sort((a, b) => {
    const score = (p: PlaceLike) => {
      if (p.lat == null || p.lng == null) return Infinity;
      let min = Infinity;
      for (const anchor of withCoords) {
        const d = distanceMeters(
          { lat: anchor.lat!, lng: anchor.lng! },
          { lat: p.lat!, lng: p.lng! },
        );
        if (d < min) min = d;
      }
      return min;
    };
    return score(a) - score(b);
  });
}

/** 已選 + 新推薦合併為 plannedStops */
export function mergePlannedStops(
  selected: ChatPlaceItem[],
  additional: ChatPlaceItem[],
): ChatPlaceItem[] {
  return dedupePlaces([...selected, ...additional]) as ChatPlaceItem[];
}

export function extractPlaceIds(places: PlaceLike[]): string[] {
  return dedupePlaces(places).map((p) => placeIdentityKey(p));
}

export function extractPlaceNames(places: PlaceLike[]): string[] {
  return dedupePlaces(places).map((p) => placeDisplayName(p as RoamieRecommendationItem));
}

/** 同步 session 記憶欄位 */
export function syncSessionPlaceMemory(session: ChatPlanningSession): ChatPlanningSession {
  const selected = dedupePlaces(session.selectedPlaces) as ChatPlaceItem[];
  const recommended = dedupePlaces(session.recommendedPlaces) as ChatPlaceItem[];
  const plannedStops = mergePlannedStops(
    selected,
    filterAlreadySelectedPlaces(recommended, selected) as ChatPlaceItem[],
  );
  return {
    ...session,
    selectedPlaces: selected,
    selectedPlaceIds: extractPlaceIds(selected),
    selectedPlaceNames: extractPlaceNames(selected),
    plannedStops,
  };
}

/** 合併 AI 推薦：已選固定在前，新點去重且最多 maxNew 個 */
export function mergeRecommendationsWithSelected(
  selected: RoamieRecommendationItem[],
  aiRecs: RoamieRecommendationItem[],
  opts?: { maxNew?: number; location?: RoamieLocation | null },
): RoamieRecommendationItem[] {
  const base = dedupePlaces(selected.map((p) => roamieRecToChatItem(p)));
  let newOnes = filterAlreadySelectedPlaces(
    dedupePlaces(aiRecs.map((p) => roamieRecToChatItem(p))),
    base,
  );
  if (opts?.location && base.length) {
    newOnes = sortByProximityToAnchors(newOnes, base);
  }
  const maxNew = opts?.maxNew ?? 4;
  newOnes = newOnes.slice(0, maxNew);
  return dedupePlaces([...base, ...newOnes]);
}

/** 行程生成用：已選優先，含聊天中新增的 plannedStops */
export function buildTripFromSelectedPlaces(session: ChatPlanningSession): ChatPlaceItem[] {
  const synced = syncSessionPlaceMemory(session);
  if (synced.plannedStops?.length) return synced.plannedStops;
  return synced.selectedPlaces;
}

export function buildExcludePlacesBlock(session: ChatPlanningSession): string {
  const names = [
    ...extractPlaceNames(session.selectedPlaces),
    ...extractPlaceNames(session.plannedStops ?? []),
    ...(session.rejectedPlaceNames ?? []),
  ];
  const unique = [...new Set(names)];
  if (!unique.length) return "（尚無已選地點）";
  return unique.join("、");
}

export function buildPlanningMemoryContext(session: ChatPlanningSession): string {
  const synced = syncSessionPlaceMemory(session);
  const lines = [
    "【行程規劃記憶】",
    `selectedMood：${synced.selectedMood ?? synced.mood ?? "（未指定）"}`,
    `selectedPlaceNames：${synced.selectedPlaceNames?.join("、") || "（無）"}`,
    `selectedPlaceIds：${synced.selectedPlaceIds?.join(" | ") || "（無）"}`,
    `plannedStops（已選+已加入）：${extractPlaceNames(synced.plannedStops ?? []).join("、") || "（無）"}`,
    `禁止重複推薦：${buildExcludePlacesBlock(synced)}`,
    synced.rejectedPlaceNames?.length
      ? `rejectedPlaces：${synced.rejectedPlaceNames.join("、")}`
      : "",
    "規則：新 recommendations 不得與 selectedPlaceNames 相同、高度相似或同地址；僅推薦可搭配、順路、類型互補的新地點。",
  ].filter(Boolean);
  return lines.join("\n");
}
