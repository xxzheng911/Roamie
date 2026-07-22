/**
 * Canonical landmark identity — Planner 分配前去重用。
 *
 * 不依賴單一城市硬編碼。合併條件：
 * - 相同 placeId
 * - normalizedName / core 相同
 * - 多語別名摺疊（同義 landmark token）
 * - 母地標與其商業／複合設施（城／town／solamachi…）高度重疊
 * - 座標極近且名稱高度相似
 */

import type { PlaceResult } from "@/lib/place-result";
import { distanceMeters } from "@/lib/geo-distance";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { normalizeCorePlaceName } from "@/lib/place-planning-memory";
import { resolveTripPlaceId } from "@/lib/ai/ai-trip-place-allocator";
import { stripCommercialAnnexSuffix } from "@/lib/ai/landmark-keywords";

const COMMERCIAL_ANNEX_SUFFIX =
  /(?:城|town|タウン|シティ|city|ソラマチ|solamachi|商業設施|購物中心|ショッピング|shoppingmall|mall)$/i;

/**
 * 多語同義摺疊（entity token，非城市列表）。
 * 例：晴空塔／Skytree／スカイツリー → 同一 token。
 */
const MULTILINGUAL_LANDMARK_FOLDS: Array<{ re: RegExp; token: string }> = [
  // 塔本體 + 商業複合設施（Town／Solamachi／城）摺成同一 token
  {
    re: /(?:tokyo|東京)?(?:\s*)?(?:skytree|スカイツリー|晴空塔)(?:城|town|タウン|ソラマチ|solamachi)?/gi,
    token: "skytree",
  },
  { re: /tokyo\s*tower|とうきょうタワー|東京塔|東京タワー/gi, token: "tokyotower" },
  { re: /tokyo\s*station|東京駅|東京車站|东京站/gi, token: "tokyostation" },
  { re: /senso[-\s]?ji|sensouji|淺草寺|浅草寺/gi, token: "sensoji" },
  { re: /meiji\s*jingu|明治神宮|明治神宫/gi, token: "meijijingu" },
  { re: /shibuya\s*sky|澀谷\s*sky|渋谷スカイ|渋谷sky|澀谷sky/gi, token: "shibuyasky" },
];

const NEAR_DUP_METERS = 450;
const NEAR_SAME_SPOT_METERS = 120;

function hasCoords(place: PlaceResult): boolean {
  return (
    place.lat != null &&
    place.lng != null &&
    Number.isFinite(place.lat) &&
    Number.isFinite(place.lng) &&
    !(Math.abs(place.lat) < 0.0001 && Math.abs(place.lng) < 0.0001)
  );
}

function compactName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[（(][^)）]*[)）]/g, "");
}

export { stripCommercialAnnexSuffix };

function foldMultilingualLandmarkTokens(text: string): string {
  let out = text;
  for (const { re, token } of MULTILINGUAL_LANDMARK_FOLDS) {
    out = out.replace(re, token);
  }
  return out;
}

/**
 * 穩定的 canonical landmark key（分配前去重用）。
 */
export function resolveCanonicalLandmarkKey(place: PlaceResult): string {
  const id = (place.id ?? "").trim();
  const rawName = place.name ?? "";
  const core = normalizeCorePlaceName(rawName);
  const compact = compactName(rawName);
  const folded = foldMultilingualLandmarkTokens(compact);
  const foldedCore = foldMultilingualLandmarkTokens(core.replace(/\s+/g, ""));
  const stripped = stripCommercialAnnexSuffix(foldedCore || folded);

  // 優先：摺疊／剝附屬後的語意 key；placeId 僅作同分組輔助，不獨占
  // （同地標常有不同 Place ID：塔本體 vs 商業設施）
  if (stripped.length >= 3) return `canon:${stripped}`;
  if (folded.length >= 3) return `canon:${folded}`;
  if (core) return `canon:${core}`;
  if (id) return `id:${id}`;
  return `name:${compact || "?"}`;
}

export function normalizeLandmarkNameForDedup(name: string): string {
  const core = normalizeCorePlaceName(name);
  const folded = foldMultilingualLandmarkTokens(compactName(name));
  return stripCommercialAnnexSuffix(foldMultilingualLandmarkTokens(core.replace(/\s+/g, "")) || folded);
}

function nameStemOverlap(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length < 4) return false;
  return longer.includes(shorter);
}

function scoreCanonicalRepresentative(place: PlaceResult, key: string): number {
  const name = place.name ?? "";
  const norm = normalizeLandmarkNameForDedup(name);
  let score = (place.rating ?? 0) * Math.log10((place.userRatingCount ?? 0) + 10);
  if (key.endsWith(norm) || key === `canon:${norm}`) score += 80;
  if (COMMERCIAL_ANNEX_SUFFIX.test(compactName(name))) score -= 50;
  if (/tourist_attraction|historical_landmark/i.test(
    [place.primaryType, ...(place.types ?? [])].filter(Boolean).join(" "),
  )) {
    score += 40;
  }
  score += Math.max(0, 20 - name.length);
  return score;
}

export type CanonicalLandmarkDedupeResult = {
  places: PlaceResult[];
  /** key → kept place */
  byKey: Map<string, PlaceResult>;
  removed: Array<{ place: PlaceResult; kept: PlaceResult; key: string; reason: string }>;
  uniqueCanonicalCount: number;
};

/**
 * 分配前 canonical landmark 去重：每 key 保留一個代表點。
 * 另以座標近鄰 + 名稱高度相似做二次合併（捕捉漏網同義點）。
 */
export function dedupeByCanonicalLandmark(places: PlaceResult[]): CanonicalLandmarkDedupeResult {
  type Member = { place: PlaceResult; key: string };
  const members: Member[] = places.map((place) => ({
    place,
    key: resolveCanonicalLandmarkKey(place),
  }));

  // Union-Find over member indices
  const parent = members.map((_, i) => i);
  const find = (i: number): number => {
    let cur = i;
    while (parent[cur] !== cur) {
      parent[cur] = parent[parent[cur]!]!;
      cur = parent[cur]!;
    }
    return cur;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const removed: CanonicalLandmarkDedupeResult["removed"] = [];

  // 1) same canonical key
  const firstByKey = new Map<string, number>();
  for (let i = 0; i < members.length; i += 1) {
    const key = members[i]!.key;
    const prev = firstByKey.get(key);
    if (prev == null) {
      firstByKey.set(key, i);
      continue;
    }
    union(prev, i);
  }

  // 2) same placeId / proximity + stem
  for (let i = 0; i < members.length; i += 1) {
    const a = members[i]!.place;
    const normA = normalizeLandmarkNameForDedup(a.name ?? "");
    const idA = resolveTripPlaceId(a);
    for (let j = i + 1; j < members.length; j += 1) {
      if (find(i) === find(j)) continue;
      const b = members[j]!.place;
      const idB = resolveTripPlaceId(b);
      if (idA && idB && idA === idB) {
        union(i, j);
        continue;
      }
      const normB = normalizeLandmarkNameForDedup(b.name ?? "");
      if (!hasCoords(a) || !hasCoords(b)) {
        // 無座標：僅當摺疊後名稱完全相同
        if (normA && normA === normB) union(i, j);
        continue;
      }
      const d = distanceMeters(
        { lat: a.lat!, lng: a.lng! },
        { lat: b.lat!, lng: b.lng! },
      );
      const stemHit = nameStemOverlap(normA, normB) || normA === normB;
      if (
        (d <= NEAR_SAME_SPOT_METERS && stemHit) ||
        (d <= NEAR_DUP_METERS && nameStemOverlap(normA, normB))
      ) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < members.length; i += 1) {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(i);
    groups.set(root, list);
  }

  const byKey = new Map<string, PlaceResult>();
  const finalPlaces: PlaceResult[] = [];
  const seenRep = new Set<PlaceResult>();

  for (const indices of groups.values()) {
    const ranked = [...indices].sort(
      (ia, ib) =>
        scoreCanonicalRepresentative(members[ib]!.place, members[ib]!.key) -
        scoreCanonicalRepresentative(members[ia]!.place, members[ia]!.key),
    );
    const winnerIdx = ranked[0]!;
    const winner = members[winnerIdx]!.place;
    const winKey = members[winnerIdx]!.key;
    byKey.set(winKey, winner);
    if (!seenRep.has(winner)) {
      seenRep.add(winner);
      finalPlaces.push(winner);
    }
    for (const idx of ranked.slice(1)) {
      const loser = members[idx]!.place;
      removed.push({
        place: loser,
        kept: winner,
        key: winKey,
        reason:
          members[idx]!.key === winKey ? "same_canonical_key" : "proximity_similar_name",
      });
      logAiPipeline(
        "[CANONICAL_LANDMARK_DEDUP]",
        `key=${winKey}`,
        `kept=${winner.name}`,
        `dropped=${loser.name}`,
        `reason=${members[idx]!.key === winKey ? "same_canonical_key" : "proximity_similar_name"}`,
      );
    }
  }

  // 依輸入順序重排代表
  const ordered: PlaceResult[] = [];
  const emitted = new Set<PlaceResult>();
  for (const place of places) {
    const group = [...groups.values()].find((idxs) =>
      idxs.some((i) => members[i]!.place === place),
    );
    if (!group) continue;
    const ranked = [...group].sort(
      (ia, ib) =>
        scoreCanonicalRepresentative(members[ib]!.place, members[ib]!.key) -
        scoreCanonicalRepresentative(members[ia]!.place, members[ia]!.key),
    );
    const winner = members[ranked[0]!]!.place;
    if (emitted.has(winner)) continue;
    emitted.add(winner);
    ordered.push(winner);
  }

  return {
    places: ordered.length ? ordered : finalPlaces,
    byKey,
    removed,
    uniqueCanonicalCount: ordered.length || finalPlaces.length,
  };
}

export function countUniqueCanonicalLandmarks(places: PlaceResult[]): number {
  return dedupeByCanonicalLandmark(places).uniqueCanonicalCount;
}

/** 規劃最低 unique canonical 數量：slow=days×2，其餘 days×3 */
export function requiredCanonicalCandidatesForTrip(
  days: number,
  pace?: "slow" | "medium" | "active",
): number {
  const safe = Math.max(1, days);
  return pace === "slow" ? safe * 2 : safe * 3;
}
