import { distanceMeters } from "@/lib/map-explore";
import {
  normalizeNightMarketFiller,
  stripCommercialAnnexSuffix,
  stripSubPlaceMarkers,
} from "@/lib/ai/landmark-keywords";
import type { RoamieLocation } from "@/lib/ai/context";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import type { ChatMsg } from "@/lib/chat-history";
import { extractRecommendedFromMsgs } from "@/lib/ai/chat-recommendation-refresh";
import { resolveDestinationApproxCenter } from "@/lib/ai/destination-geocode";
import { isGenericPlaceLabel, isValidItineraryStopPlace } from "@/lib/ai/generic-place-label";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import type { ChatPlaceItem, ChatPlanningSession } from "@/lib/chat-session";
import { placeDisplayName, roamieRecToChatItem } from "@/lib/chat-session";
import { resolveCanonicalPlaceIdentity } from "@/lib/place-canonical-identity";

export type PlaceLike = {
  name: string;
  placeName?: string;
  placeId?: string;
  googlePlaceId?: string;
  canonicalPlaceId?: string;
  id?: string;
  address?: string;
  type?: string;
  lat?: number | null;
  lng?: number | null;
};

export function exactCanonicalIdentityMatch(
  candidate: PlaceLike,
  previous: PlaceLike,
): string | null {
  const candidateIdentity = resolveCanonicalPlaceIdentity(candidate);
  const previousIdentity = resolveCanonicalPlaceIdentity(previous);
  if (!candidateIdentity.identityKey || !previousIdentity.identityKey) return null;
  if (candidateIdentity.identityKey !== previousIdentity.identityKey) return null;

  // Never let an entirely generic/missing fallback identity collapse unrelated places.
  if (
    candidateIdentity.source === "deterministic_fallback" &&
    candidateIdentity.identityKey.includes("name=missing") &&
    candidateIdentity.identityKey.includes("address=missing") &&
    candidateIdentity.identityKey.includes("coords=missing,missing")
  ) {
    return null;
  }
  return candidateIdentity.identityKey;
}

/** Structured Nearby continuation excludes exact place identity only. */
export function filterExactPreviouslyRecommendedPlaces<T extends PlaceLike>(
  candidates: T[],
  previous: PlaceLike[],
): T[] {
  if (!previous.length) return dedupePlaces(candidates);
  return dedupePlaces(candidates).filter(
    (candidate) => !previous.some((item) => exactCanonicalIdentityMatch(candidate, item)),
  );
}

/**
 * Core place-name normalization — same landmark under different附属 names collapses
 * to one key. Fully data-driven: strip sub-place markers / night-market fillers /
 * generic facility suffixes. No per-city or per-landmark hardcode lists.
 */
export function normalizeCorePlaceName(name: string): string {
  const raw = name.trim();
  if (!raw) return "";

  const compact = raw
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[（(].*[)）]/g, "");

  // Night-market naming convention first: 饒河街觀光夜市 → 饒河夜市 (so the
  // main market and its 牌樓/入口 sub-landmarks collapse to the same core).
  const nightMarketNormalized = normalizeNightMarketFiller(compact);

  // Strip trailing sub-landmark markers (牌樓/入口/大門/觀景台/天守閣/公共藝術…)
  // so a main landmark and its附属地標 normalize to the same core name.
  const withoutSubMarkers = stripSubPlaceMarkers(nightMarketNormalized);

  const stripped = withoutSubMarkers
    .replace(/親水公園|親水平台|景觀親水平台|親水/g, "")
    .replace(/國家森林遊樂區|國家風景區|森林遊樂區|風景區/g, "")
    .replace(/五合目|四合目|三合目|二合目|一合目/g, "")
    .replace(/火車站|火车站|車站|车站/g, "")
    .replace(/步道|停車場|停车场/g, "")
    .replace(/公園|公园/g, "");

  // 母地標商業複合設施（晴空塔城／Skytree Town）→ 與母地標同 core
  const withoutAnnex = stripCommercialAnnexSuffix(stripped || withoutSubMarkers || compact);
  return withoutAnnex || stripped || withoutSubMarkers || compact;
}

/** 正規化名稱 — 同 normalizeCorePlaceName */
export function normalizePlaceName(name: string): string {
  return normalizeCorePlaceName(name);
}

function normalizeAddress(address?: string): string {
  if (!address?.trim()) return "";
  return address.trim().toLowerCase().replace(/\s+/g, "");
}

/** 穩定 id：placeId > name+address */
export function placeIdentityKey(p: PlaceLike): string {
  return resolveCanonicalPlaceIdentity(p).identityKey;
}

export function isSameCorePlace(a: PlaceLike, b: PlaceLike): boolean {
  const ca = normalizePlaceName(a.placeName ?? a.name);
  const cb = normalizePlaceName(b.placeName ?? b.name);
  return Boolean(ca && cb && ca === cb);
}

/** 名稱高度相似（子字串或核心地點相同） */
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
  if (isSameCorePlace(a, b)) return true;
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
    blockedCoreNames?: string[];
  },
): T[] {
  let list = dedupePlaces(candidates);
  const blockedCores = new Set(
    (opts.blockedCoreNames ?? []).map((n) => normalizePlaceName(n)).filter(Boolean),
  );
  const block: PlaceLike[] = [
    ...(opts.selected ?? []),
    ...(opts.recommended ?? []),
    ...(opts.rejectedNames ?? []).map((name) => ({ name })),
    ...(opts.recentNames ?? []).map((name) => ({ name })),
  ];
  if (block.length) list = filterAlreadySelectedPlaces(list, block);
  if (!blockedCores.size) return list;
  return list.filter((c) => {
    const core = normalizePlaceName(c.placeName ?? c.name);
    return !core || !blockedCores.has(core);
  });
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

export function filterExcludedPlaceIds<T extends PlaceLike>(
  candidates: T[],
  excludeIds: string[],
): T[] {
  if (!excludeIds.length) return candidates;
  const block = new Set(
    excludeIds.map((id) => {
      const t = id.trim();
      if (!t) return "";
      if (t.startsWith("id:") || t.startsWith("na:") || t.startsWith("n:")) return t;
      return `id:${t}`;
    }).filter(Boolean),
  );
  return candidates.filter((p) => !block.has(placeIdentityKey(p)));
}

/**
 * Structured Nearby continuation uses canonical identity keys end-to-end.
 * Unlike the legacy generic exclusion helper, already-namespaced keys must not
 * be wrapped as `id:<key>` or they can never match a candidate identity.
 */
export function filterExactExcludedPlaceIdentities<T extends PlaceLike>(
  candidates: T[],
  excludeIds: string[],
): T[] {
  if (!excludeIds.length) return dedupePlaces(candidates);
  const namespaces = ["google:", "canonical:", "saved:", "fallback:"];
  const block = new Set(
    excludeIds
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => {
        if (namespaces.some((prefix) => value.startsWith(prefix))) return value;
        const rawId = value.startsWith("id:") ? value.slice(3) : value;
        return resolveCanonicalPlaceIdentity({ id: rawId, name: "" }).identityKey;
      }),
  );
  return dedupePlaces(candidates).filter(
    (candidate) => !block.has(resolveCanonicalPlaceIdentity(candidate).identityKey),
  );
}

export function collectRecommendedNormalizedNames(
  session: ChatPlanningSession,
): string[] {
  const names = new Set<string>();
  for (const p of session.recommendedPlaces) {
    const core = normalizePlaceName(p.name);
    if (core) names.add(core);
  }
  for (const n of session.recommendedNormalizedNames ?? []) {
    if (n) names.add(n);
  }
  for (const n of session.rejectedPlaceNames ?? []) {
    const core = normalizePlaceName(n);
    if (core) names.add(core);
  }
  return [...names];
}

export function appendRecommendedNormalizedNames(
  session: ChatPlanningSession,
  newPlaces: PlaceLike[],
): string[] {
  const prev = new Set(collectRecommendedNormalizedNames(session));
  for (const p of newPlaces) {
    const core = normalizePlaceName(p.placeName ?? p.name);
    if (core) prev.add(core);
  }
  return [...prev];
}

export function appendRecommendedPlaceIds(
  session: ChatPlanningSession,
  newPlaces: PlaceLike[],
): string[] {
  const prev = new Set(session.recommendedPlaceIds ?? []);
  for (const p of session.recommendedPlaces) prev.add(placeIdentityKey(p));
  for (const p of newPlaces) prev.add(placeIdentityKey(p));
  return [...prev];
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
  const recommendedPlaceIds = appendRecommendedPlaceIds(session, recommended);
  const recommendedNormalizedNames = appendRecommendedNormalizedNames(session, recommended);
  return {
    ...session,
    selectedPlaces: selected,
    selectedPlaceIds: extractPlaceIds(selected),
    selectedPlaceNames: extractPlaceNames(selected),
    plannedStops,
    recommendedPlaceIds,
    recommendedNormalizedNames,
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
  return resolveItineraryPlaceSources(session).places;
}

export type ItineraryPlaceSource =
  | "selectedPlaces"
  | "recommendedPlaces"
  | "plannedStops"
  | "renderedCards"
  | "fetch";

/** CREATE_ITINERARY 地點來源優先順序 */
export function resolveItineraryPlaceSources(
  session: ChatPlanningSession,
  msgs?: ChatMsg[],
): { places: ChatPlaceItem[]; source: ItineraryPlaceSource } {
  const synced = syncSessionPlaceMemory(session);

  if (synced.selectedPlaces.length > 0) {
    return { places: synced.selectedPlaces, source: "selectedPlaces" };
  }
  if (synced.recommendedPlaces.length > 0) {
    return { places: synced.recommendedPlaces, source: "recommendedPlaces" };
  }
  if (synced.plannedStops?.length) {
    return { places: synced.plannedStops, source: "plannedStops" };
  }
  if (msgs?.length) {
    const fromMsgs = extractRecommendedFromMsgs(msgs);
    if (fromMsgs.length) {
      return { places: fromMsgs, source: "renderedCards" };
    }
  }
  return { places: [], source: "fetch" };
}

/** 補齊 placeId / 座標，讓已推薦卡片能進 itinerary */
export function normalizePlaceForItineraryBuild(
  place: ChatPlaceItem | RoamieRecommendationItem,
  destination?: string,
): ChatPlaceItem {
  const label = destination ? normalizeDestinationLabel(destination) : "";
  const name = (place.placeName ?? place.name ?? "").trim();
  const placeId =
    place.placeId?.trim() ||
    place.googlePlaceId?.trim() ||
    (place as RoamieRecommendationItem & { id?: string }).id?.trim();
  let lat = place.lat ?? undefined;
  let lng = place.lng ?? undefined;
  if ((placeId == null || !placeId) && (lat == null || lng == null || (Math.abs(lat) <= 0.001 && Math.abs(lng) <= 0.001))) {
    const approx = label ? resolveDestinationApproxCenter(label) : null;
    if (approx) {
      lat = approx.lat;
      lng = approx.lng;
    }
  }
  return {
    ...(place as ChatPlaceItem),
    name,
    placeName: place.placeName ?? name,
    placeId: placeId || undefined,
    googlePlaceId: place.googlePlaceId ?? placeId,
    lat,
    lng,
    address: place.address?.trim() || name,
  };
}

export function preparePlacesForItineraryBuild(
  places: ChatPlaceItem[],
  destination: string,
): ChatPlaceItem[] {
  const label = normalizeDestinationLabel(destination);
  const seen = new Set<string>();
  const out: ChatPlaceItem[] = [];
  for (const raw of places) {
    const normalized = normalizePlaceForItineraryBuild(raw, label);
    const name = (normalized.placeName ?? normalized.name).trim();
    if (!name || isGenericPlaceLabel(name, label)) continue;
    const ready: ChatPlaceItem = {
      ...normalized,
      // Never invent session:/trip:/memory: ids — Place Detail only accepts real Google Place IDs.
      placeId: normalized.placeId || normalized.googlePlaceId || undefined,
      googlePlaceId: normalized.googlePlaceId || normalized.placeId || undefined,
    };
    if (!ready.placeId && !ready.googlePlaceId) {
      // Keep name for later Places Search mapping; do not fabricate ids.
      ready.placeId = undefined;
      ready.googlePlaceId = undefined;
    }
    if (!isValidItineraryStopPlace(ready, label)) continue;
    const key =
      ready.placeId?.trim() ||
      ready.googlePlaceId?.trim() ||
      `${name}@${ready.address ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ready);
  }
  return out;
}

/**
 * Explicit client → planner boundary for authoritative places.
 *
 * ChatPlaceItem is a card/session model and intentionally contains fields that
 * are not part of the itinerary server-function input schema.  Do not spread a
 * chat card across that boundary: native/server-function serialization can
 * preserve nullable legacy metadata which the strict planner validator rejects.
 */
export function buildPlannerRequiredAnchors(
  places: ChatPlaceItem[],
  destination: string,
  requiredBySelection = false,
): RoamieRecommendationItem[] {
  return preparePlacesForItineraryBuild(places, destination).map((place) => {
    const googlePlaceId = place.googlePlaceId?.trim() || place.placeId?.trim() || undefined;
    const types = Array.isArray(place.types)
      ? place.types.filter((type): type is string => typeof type === "string" && Boolean(type.trim()))
      : undefined;
    const numericArray = (value: unknown): number[] | undefined => {
      if (!Array.isArray(value)) return undefined;
      const valid = value.filter((item): item is number => Number.isFinite(item));
      return valid.length ? valid : undefined;
    };
    return {
      name: place.name,
      type: typeof place.type === "string" ? place.type : "地點",
      primaryType: typeof place.primaryType === "string" ? place.primaryType : null,
      types,
      description: typeof place.description === "string" ? place.description : "",
      reason: typeof place.reason === "string" ? place.reason : "",
      estimatedTime: typeof place.estimatedTime === "string" ? place.estimatedTime : "1-2 小時",
      address: typeof place.address === "string" ? place.address : "",
      lat: Number.isFinite(place.lat) ? place.lat : null,
      lng: Number.isFinite(place.lng) ? place.lng : null,
      googleMapsUrl: typeof place.googleMapsUrl === "string" ? place.googleMapsUrl : "",
      placeName: typeof place.placeName === "string" ? place.placeName : place.name,
      googlePlaceId,
      reasonSource:
        place.reasonSource === "ai" ||
        place.reasonSource === "evidence" ||
        place.reasonSource === "fallback"
          ? place.reasonSource
          : "template",
      sourceCombinationId: Number.isFinite(place.sourceCombinationId)
        ? place.sourceCombinationId
        : undefined,
      sourceCombinationIds: numericArray(place.sourceCombinationIds),
      matchedCombinationIds: numericArray(place.matchedCombinationIds),
      matchedSelectedCombinationIds: numericArray(place.matchedSelectedCombinationIds),
      sourceRegionCandidate:
        typeof place.sourceRegionCandidate === "string" ? place.sourceRegionCandidate : undefined,
      destinationScope:
        place.destinationScope === "primary" || place.destinationScope === "nearby_extension"
          ? place.destinationScope
          : undefined,
      extensionDestination:
        typeof place.extensionDestination === "string" ? place.extensionDestination : undefined,
      isRequiredBySelection: requiredBySelection || place.isRequiredBySelection === true,
      photoName: typeof place.photoName === "string" ? place.photoName : null,
      rating: Number.isFinite(place.rating) ? place.rating : null,
      userRatingCount: Number.isFinite(place.userRatingCount) ? place.userRatingCount : null,
      businessStatus:
        typeof place.businessStatus === "string" ? place.businessStatus : null,
      openStatusLabel:
        typeof place.openStatusLabel === "string" ? place.openStatusLabel : undefined,
      todayHoursLabel:
        typeof place.todayHoursLabel === "string" ? place.todayHoursLabel : undefined,
    };
  });
}

export function canBuildItineraryFromPlaceCount(count: number): boolean {
  return count >= 1;
}

/** fetch 目標數量（供混合排程使用；與 resolved target 對齊每日 ≥3） */
export function computeItineraryFetchTarget(days: number): number {
  const safe = Math.max(1, days);
  return Math.min(Math.max(safe * 3, safe + 2), 24);
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
    `recommendedPlaceIds：${synced.recommendedPlaceIds?.join(" | ") || "（無）"}`,
    `recommendedNormalizedNames：${synced.recommendedNormalizedNames?.join("、") || "（無）"}`,
    `plannedStops（已選+已加入）：${extractPlaceNames(synced.plannedStops ?? []).join("、") || "（無）"}`,
    `禁止重複推薦：${buildExcludePlacesBlock(synced)}`,
    synced.rejectedPlaceNames?.length
      ? `rejectedPlaces：${synced.rejectedPlaceNames.join("、")}`
      : "",
    "規則：新 recommendations 不得與 selectedPlaceNames 相同、高度相似或同地址；僅推薦可搭配、順路、類型互補的新地點。",
  ].filter(Boolean);
  return lines.join("\n");
}
