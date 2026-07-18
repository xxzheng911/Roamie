import type { PlaceResult } from "@/lib/place-result";
import { distanceMeters } from "@/lib/map-explore";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { normalizeCorePlaceName, normalizePlaceName } from "@/lib/place-planning-memory";
import { resolveTripPlaceId } from "@/lib/ai/ai-trip-place-allocator";
import { clusterAndDedupeLandmarks } from "@/lib/ai/landmark-cluster";

const LANDMARK_COMPLEX_RE =
  /文化園區|文創園區|創意園區|產業園區|國家森林遊樂區|國家風景區|森林遊樂區|遊樂區|主題公園|theme\s*park|national\s*park|風景區|文化公園|historic\s*site|世界遺產/i;

const CHILD_SUBPLACE_MARKERS =
  /門$|池$|堂$|殿$|樓$|亭$|碑$|塔$|坊$|坊門|照壁|牌坊|月台|站台|登山口|步道|觀景|展望|入口|出口|售票|停車|parking|gate$|pond$|hall$|pavilion/i;

const MAX_NESTED_LANDMARK_METERS = 400;

function placeCoords(place: PlaceResult): { lat: number; lng: number } | null {
  if (place.lat == null || place.lng == null) return null;
  return { lat: place.lat, lng: place.lng };
}

/** 從「子點 - 大地標」或園區名稱解析 parent key */
export function resolveParentLandmarkKey(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const dash = trimmed.match(/[-–—]\s*(.+)$/);
  if (dash?.[1]) {
    const parent = dash[1].trim();
    if (parent.length >= 3) return normalizePlaceName(parent);
  }

  if (LANDMARK_COMPLEX_RE.test(trimmed)) {
    return normalizePlaceName(trimmed);
  }

  return null;
}

function isLikelyChildSubPlace(name: string, parentKey: string): boolean {
  const norm = normalizePlaceName(name);
  if (!norm || !parentKey) return false;
  if (norm === parentKey) return false;
  if (!norm.includes(parentKey) && !parentKey.includes(norm)) return false;
  if (CHILD_SUBPLACE_MARKERS.test(name)) return true;
  if (name.includes(" - ") || name.includes("－") || name.includes("—")) return true;
  return norm.length < parentKey.length;
}

function scoreLandmarkRepresentative(place: PlaceResult, parentKey: string): number {
  const name = place.name ?? "";
  const norm = normalizePlaceName(name);
  let score = (place.rating ?? 0) * Math.log10((place.userRatingCount ?? 0) + 10);

  if (norm === parentKey) score += 100;
  if (LANDMARK_COMPLEX_RE.test(name)) score += 50;
  if (CHILD_SUBPLACE_MARKERS.test(name)) score -= 40;
  if (/[-–—]/.test(name)) score -= 20;
  score += Math.min(name.length, 30);

  return score;
}

/** 同一大地標內部子點去重：保留主地標，移除內部子點 */
export function dedupeParentLandmarkPlaces(places: PlaceResult[]): PlaceResult[] {
  const byParent = new Map<string, PlaceResult[]>();
  const standalone: PlaceResult[] = [];

  for (const place of places) {
    const parentKey = resolveParentLandmarkKey(place.name ?? "");
    if (!parentKey) {
      standalone.push(place);
      continue;
    }
    const group = byParent.get(parentKey) ?? [];
    group.push(place);
    byParent.set(parentKey, group);
  }

  const kept: PlaceResult[] = [...standalone];

  for (const [parentKey, group] of byParent) {
    if (group.length === 1) {
      kept.push(group[0]!);
      continue;
    }

    const sorted = [...group].sort(
      (a, b) => scoreLandmarkRepresentative(b, parentKey) - scoreLandmarkRepresentative(a, parentKey),
    );
    const winner = sorted[0]!;
    kept.push(winner);

    for (const dropped of sorted.slice(1)) {
      logAiPipeline(
        "[AI_PARENT_LANDMARK_DEDUP]",
        `parent=${parentKey}`,
        `kept=${winner.name}`,
        `dropped=${dropped.name}`,
      );
    }
  }

  const proximityFiltered: PlaceResult[] = [];
  const seenIds = new Set<string>();

  for (const place of kept) {
    const id = resolveTripPlaceId(place);
    if (id && seenIds.has(id)) continue;
    if (id) seenIds.add(id);
    proximityFiltered.push(place);
  }

  const out: PlaceResult[] = [];
  for (const place of proximityFiltered) {
    const coords = placeCoords(place);
    const norm = normalizeCorePlaceName(place.name ?? "");
    let dominated = false;

    for (const existing of out) {
      const existingNorm = normalizeCorePlaceName(existing.name ?? "");
      if (!norm || !existingNorm) continue;

      const nested =
        (norm.includes(existingNorm) || existingNorm.includes(norm)) &&
        norm !== existingNorm;
      if (!nested) continue;

      const a = placeCoords(existing);
      if (coords && a && distanceMeters(coords, a) > MAX_NESTED_LANDMARK_METERS) continue;

      const placeIsChild = isLikelyChildSubPlace(place.name ?? "", existingNorm);
      const existingIsChild = isLikelyChildSubPlace(existing.name ?? "", norm);

      if (placeIsChild && !existingIsChild) {
        dominated = true;
        logAiPipeline(
          "[AI_PARENT_LANDMARK_DEDUP]",
          `reason=nested_child`,
          `kept=${existing.name}`,
          `dropped=${place.name}`,
        );
        break;
      }
      if (existingIsChild && !placeIsChild) {
        const idx = out.indexOf(existing);
        if (idx >= 0) {
          logAiPipeline(
            "[AI_PARENT_LANDMARK_DEDUP]",
            `reason=nested_child`,
            `kept=${place.name}`,
            `dropped=${existing.name}`,
          );
          out[idx] = place;
          dominated = true;
          break;
        }
      }
    }

    if (!dominated) out.push(place);
  }

  // Final generic pass: same-core-name + proximity clustering (handles cases the
  // dash/complex heuristics above miss, e.g. 饒河街觀光夜市 vs 饒河夜市牌樓).
  return clusterAndDedupeLandmarks(out).places;
}
