/**
 * Planner Day Route + Capacity Assembly（P1 Step 1）
 *
 * 職責（Contract 允許）：
 * - 同日 Route Constraint：nearest-neighbor 順序、區域錨點、距離門檻跳過
 * - Day Capacity：最低有效地點數；候選跳過後繼續取下一筆
 * - 近郊延伸（nearbyExtensions）集中於單一天
 *
 * 禁止：對整個 Candidate Pool 依 rating／DNA／Memory 重排或新建 Planner Score。
 */

import type { PlaceResult } from "@/lib/place-result";
import { distanceMeters } from "@/lib/geo-distance";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import type { TripStyleKey } from "@/lib/ai/ai-trip-style";
import { resolveDestinationApproxCenter } from "@/lib/ai/destination-geocode";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { resolveCanonicalLandmarkKey } from "@/lib/ai/canonical-landmark";
import {
  allocateNearbyExtensionDays,
  logNearbyExtensionDayAllocation,
  logNearbyExtensionPlannerResult,
  NEARBY_EXTENSION_MAX_STOPS,
  NEARBY_EXTENSION_MIN_STOPS,
  resolveNearbyExtensionDedicatedDay,
} from "@/lib/ai/nearby-extension-requirements";

/** 本地 place id，避免經 allocator → day-plan-source 循環依賴 */
function placeId(place: PlaceResult): string {
  const id = (place.id ?? "").trim();
  if (id) return id;
  const name = (place.name ?? "").trim().toLowerCase().replace(/\s+/g, "");
  return name ? `name:${name}` : "";
}

function identityKeys(place: PlaceResult): string[] {
  const id = placeId(place);
  const canon = resolveCanonicalLandmarkKey(place);
  return [id, canon].filter(Boolean);
}

function extractAreaName(address: string): string {
  if (!address) return "";
  // 去掉都道府縣／市前綴後再取区，避免「東京都台東区」→「都台東区」
  const trimmed = address
    .replace(/^[\u4e00-\u9fff]+[都道府県]/, "")
    .replace(/^[\u4e00-\u9fff]+市/, "");
  const ward = trimmed.match(/([\u4e00-\u9fff]{2,3}[區区])/);
  if (ward?.[1]) return ward[1];
  const m =
    address.match(/([\u4e00-\u9fff]{1,4}[鄉鎮市])/) ||
    address.match(/([\uac00-\ud7a3]+[구동])/);
  return m?.[1] ?? address.split(",")[0]?.trim() ?? "";
}

/** 輕量 DayPlan 形狀，避免與 ai-day-plan-source 循環依賴 */
export type AssemblyDayPlanEntry = {
  time: string;
  label: string;
  name: string;
  place: PlaceResult;
};

export type AssemblyDayPlan = {
  day: number;
  entries: AssemblyDayPlanEntry[];
  isIncomplete?: boolean;
};

function ensureDays(plans: AssemblyDayPlan[], days: number): AssemblyDayPlan[] {
  const safe = Math.max(1, days);
  const byDay = new Map(plans.map((p) => [p.day, p]));
  const out: AssemblyDayPlan[] = [];
  for (let d = 1; d <= safe; d += 1) {
    out.push(byDay.get(d) ?? { day: d, entries: [] });
  }
  return out;
}

/** 同日相鄰景點合理上限（公尺） */
export const PLANNER_SAME_DAY_MAX_LEG_M = 12_000;
/** 相對當日錨點的合理距離（公尺）；超過則 Route skip */
export const PLANNER_DAY_ANCHOR_RADIUS_M = 18_000;
/** 近郊延伸相對延伸地中心的匹配半徑 */
/** Hakone / Kamakura area attractions can sit farther from city centroid */
export const PLANNER_NEARBY_MATCH_RADIUS_M = 22_000;

export type PlannerPaceHint = "slow" | "medium" | "active";

export type PlannerSkipReason =
  | "route_too_far"
  | "duplicate"
  | "no_coords"
  | "nearby_reserved_other_day"
  | "capacity_full";

export type DayAssemblyDiagnostics = {
  day: number;
  assignedCount: number;
  finalPlaceCount: number;
  areas: string[];
  coords: Array<{ name: string; lat: number; lng: number }>;
  adjacentDistancesM: number[];
  skipped: Array<{ name: string; reason: PlannerSkipReason }>;
  capacityFallbackTriggered: boolean;
};

export type PlannerAssemblyResult = {
  plans: AssemblyDayPlan[];
  diagnostics: DayAssemblyDiagnostics[];
  candidateInsufficient: boolean;
  capacityFallbackTriggered: boolean;
};

export function minEffectivePlacesPerDay(pace?: PlannerPaceHint): number {
  if (pace === "slow") return 2;
  return 3;
}

function hasCoords(place: PlaceResult): boolean {
  return (
    place.lat != null &&
    place.lng != null &&
    Number.isFinite(place.lat) &&
    Number.isFinite(place.lng) &&
    !(Math.abs(place.lat) < 0.0001 && Math.abs(place.lng) < 0.0001)
  );
}

export function placeDistanceM(a: PlaceResult, b: PlaceResult): number {
  if (!hasCoords(a) || !hasCoords(b)) return Number.POSITIVE_INFINITY;
  return distanceMeters({ lat: a.lat!, lng: a.lng! }, { lat: b.lat!, lng: b.lng! });
}

export function computeDayCentroid(places: PlaceResult[]): { lat: number; lng: number } | null {
  const withCoords = places.filter(hasCoords);
  if (!withCoords.length) return null;
  const sum = withCoords.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat!, lng: acc.lng + p.lng! }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / withCoords.length, lng: sum.lng / withCoords.length };
}

/**
 * 同日路線順序最佳化（nearest-neighbor）。
 * 不丟棄地點：超過門檻時仍接上剩餘點中最近者，並由診斷記錄長腿。
 */
export function orderPlacesNearestNeighbor(
  places: PlaceResult[],
  maxLegM = PLANNER_SAME_DAY_MAX_LEG_M,
): { ordered: PlaceResult[]; longLegs: Array<{ from: string; to: string; meters: number }> } {
  if (places.length <= 1) return { ordered: [...places], longLegs: [] };
  const remaining = [...places];
  const ordered: PlaceResult[] = [];
  const longLegs: Array<{ from: string; to: string; meters: number }> = [];
  let current = remaining.shift()!;
  ordered.push(current);

  while (remaining.length) {
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i += 1) {
      const d = placeDistanceM(current, remaining[i]!);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0]!;
    if (Number.isFinite(bestDist) && bestDist > maxLegM) {
      longLegs.push({
        from: current.name ?? "?",
        to: next.name ?? "?",
        meters: Math.round(bestDist),
      });
    }
    ordered.push(next);
    current = next;
  }
  return { ordered, longLegs };
}

const NEARBY_ALIAS: Record<string, string[]> = {
  橫濱: ["橫濱", "横浜", "yokohama"],
  鎌倉: ["鎌倉", "kamakura"],
  箱根: ["箱根", "hakone"],
  奈良: ["奈良", "nara"],
  日光: ["日光", "nikko"],
  富士: ["富士", "fuji", "河口湖"],
  淡水: ["淡水", "tamsui", "tamshui"],
  北投: ["北投", "beitou"],
  陽明山: ["陽明山", "yangming"],
};

function nearbyMatchTokens(extension: string): string[] {
  const label = normalizeDestinationLabel(extension);
  const aliases = NEARBY_ALIAS[label] ?? [label, extension];
  return [...new Set(aliases.map((a) => a.trim().toLowerCase()).filter(Boolean))];
}

/** 地點是否屬於 nearbyExtensions 之一（名稱／地址／座標／explicit scope tag） */
export function placeMatchesNearbyExtension(
  place: PlaceResult,
  extensions: string[],
): string | null {
  if (!extensions.length) return null;

  if (
    place.destinationScope === "nearby_extension" &&
    place.extensionDestination
  ) {
    const tagged = normalizeDestinationLabel(place.extensionDestination);
    if (
      extensions.some((e) => normalizeDestinationLabel(e) === tagged)
    ) {
      return tagged;
    }
  }

  const blob = [place.name, place.address, ...(place.types ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  for (const ext of extensions) {
    const label = normalizeDestinationLabel(ext);
    const tokens = nearbyMatchTokens(ext);
    if (tokens.some((t) => t && blob.includes(t))) return label;

    const center = resolveDestinationApproxCenter(label);
    if (center && hasCoords(place)) {
      const d = distanceMeters(
        { lat: place.lat!, lng: place.lng! },
        { lat: center.lat, lng: center.lng },
      );
      if (d <= PLANNER_NEARBY_MATCH_RADIUS_M) return label;
    }
  }
  return null;
}

export function partitionNearbyExtensionPlaces(
  places: PlaceResult[],
  extensions: string[],
): { nearby: PlaceResult[]; primary: PlaceResult[] } {
  if (!extensions.length) return { nearby: [], primary: [...places] };
  const nearby: PlaceResult[] = [];
  const primary: PlaceResult[] = [];
  for (const place of places) {
    if (placeMatchesNearbyExtension(place, extensions)) nearby.push(place);
    else primary.push(place);
  }
  return { nearby, primary };
}

/**
 * Dedicated nearby day — last day of the trip (東京 6 天＋箱根 → Day 6).
 * Multiple extensions use {@link allocateNearbyExtensionDays}.
 */
export function resolveNearbyExtensionDay(days: number): number {
  return resolveNearbyExtensionDedicatedDay(days);
}

function entryPlaceId(entry: AssemblyDayPlanEntry): string {
  return placeId(entry.place) || entry.name;
}

function cloneEntry(entry: AssemblyDayPlanEntry, place?: PlaceResult): AssemblyDayPlanEntry {
  const p = place ?? entry.place;
  return {
    time: entry.time,
    label: entry.label,
    name: p.name ?? entry.name,
    place: p,
  };
}

function reorderDayEntriesByRoute(entries: AssemblyDayPlanEntry[]): {
  entries: AssemblyDayPlanEntry[];
  adjacentDistancesM: number[];
  longLegs: Array<{ from: string; to: string; meters: number }>;
} {
  if (entries.length <= 1) {
    return { entries: [...entries], adjacentDistancesM: [], longLegs: [] };
  }
  const times = entries.map((e) => e.time).sort((a, b) => a.localeCompare(b));
  const places = entries.map((e) => e.place);
  const { ordered, longLegs } = orderPlacesNearestNeighbor(places);
  const byId = new Map(entries.map((e) => [entryPlaceId(e), e]));
  const rebuilt: AssemblyDayPlanEntry[] = [];
  const adjacentDistancesM: number[] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const place = ordered[i]!;
    const prev = byId.get(placeId(place) || place.name || "") ?? entries[i]!;
    rebuilt.push(cloneEntry(prev, place));
    if (i > 0) {
      const d = placeDistanceM(ordered[i - 1]!, place);
      if (Number.isFinite(d)) adjacentDistancesM.push(Math.round(d));
    }
  }
  // 時間槽維持由早到晚，地點改為路線序
  return {
    entries: rebuilt.map((entry, index) => ({
      ...entry,
      time: times[index] ?? entry.time,
    })),
    adjacentDistancesM,
    longLegs,
  };
}

function logSkip(day: number, name: string, reason: PlannerSkipReason): void {
  logAiPipeline(
    "[AI_PLANNER_CANDIDATE_SKIP]",
    `day=${day}`,
    `name=${name}`,
    `reason=${reason}`,
  );
}

function areaLabelForPlace(place: PlaceResult): string {
  return (
    extractAreaName(place.address ?? "") ||
    placeMatchesNearbyExtension(place, Object.keys(NEARBY_ALIAS)) ||
    "unknown"
  );
}

/**
 * 主要組裝後處理：近郊集中 → 容量補齊 → 同日路線排序 → 診斷。
 * pool 順序視為 Recommendation Engine 已排序；僅約束跳過，不重排池。
 */
export function applyPlannerRouteAndCapacityAssembly(params: {
  plans: AssemblyDayPlan[];
  pool: PlaceResult[];
  days: number;
  style: TripStyleKey;
  nearbyExtensions?: string[];
  pace?: PlannerPaceHint;
  allowLongHaulDays?: boolean;
}): PlannerAssemblyResult {
  const safeDays = Math.max(1, params.days);
  const minPerDay = minEffectivePlacesPerDay(params.pace);
  const nearbyDayMin = params.allowLongHaulDays || (params.nearbyExtensions?.length ?? 0) > 0 ? 2 : minPerDay;
  const extensions = (params.nearbyExtensions ?? [])
    .map((e) => normalizeDestinationLabel(e))
    .filter(Boolean);

  let plans = ensureDays(params.plans, safeDays).map((plan) => ({
    day: plan.day,
    entries: [...plan.entries],
    isIncomplete: plan.isIncomplete,
  }));

  const usedIds = new Set<string>();
  for (const plan of plans) {
    for (const entry of plan.entries) {
      for (const key of identityKeys(entry.place)) usedIds.add(key);
      const id = entryPlaceId(entry);
      if (id) usedIds.add(id);
    }
  }

  const diagnosticsMap = new Map<number, DayAssemblyDiagnostics>();
  for (let d = 1; d <= safeDays; d += 1) {
    diagnosticsMap.set(d, {
      day: d,
      assignedCount: plans.find((p) => p.day === d)?.entries.length ?? 0,
      finalPlaceCount: 0,
      areas: [],
      coords: [],
      adjacentDistancesM: [],
      skipped: [],
      capacityFallbackTriggered: false,
    });
  }

  const { nearby: nearbyPool } = partitionNearbyExtensionPlaces(params.pool, extensions);
  const dayByExtension = allocateNearbyExtensionDays(safeDays, extensions);
  const extensionByDay = new Map<number, string>();
  for (const [ext, day] of dayByExtension) extensionByDay.set(day, ext);
  const dedicatedNearbyDays = new Set(dayByExtension.values());
  const nearbyDay = resolveNearbyExtensionDay(safeDays);
  let capacityFallbackTriggered = false;

  // ── 1) 近郊 Dedicated Day：每座近郊城市獨立一天，不得與 primary 混排 ──
  if (extensions.length && nearbyPool.length) {
    // Strip all nearby places from non-dedicated days first
    const collectedByExt = new Map<string, AssemblyDayPlanEntry[]>();
    for (const ext of extensions) collectedByExt.set(ext, []);

    plans = plans.map((plan) => {
      if (dedicatedNearbyDays.has(plan.day)) {
        // Clear primary stops from dedicated days — rebuild from nearby sub-pool
        const keepPrimary: AssemblyDayPlanEntry[] = [];
        for (const entry of plan.entries) {
          const matched = placeMatchesNearbyExtension(entry.place, extensions);
          if (matched) {
            const bucket = collectedByExt.get(matched) ?? [];
            bucket.push(entry);
            collectedByExt.set(matched, bucket);
            const id = entryPlaceId(entry);
            if (id) usedIds.delete(id);
          } else {
            // Displace primary stops off dedicated nearby days
            keepPrimary.push(entry);
          }
        }
        // Temporarily empty dedicated day; filled below
        for (const entry of keepPrimary) {
          const id = entryPlaceId(entry);
          if (id) usedIds.delete(id);
        }
        return { ...plan, entries: [] };
      }
      const keep: AssemblyDayPlanEntry[] = [];
      for (const entry of plan.entries) {
        const matched = placeMatchesNearbyExtension(entry.place, extensions);
        if (matched) {
          const bucket = collectedByExt.get(matched) ?? [];
          bucket.push(entry);
          collectedByExt.set(matched, bucket);
          const id = entryPlaceId(entry);
          if (id) usedIds.delete(id);
        } else {
          keep.push(entry);
        }
      }
      return { ...plan, entries: keep };
    });

    // Relocate displaced primary entries onto non-dedicated days (capacity fill later)
    const displacedPrimary: AssemblyDayPlanEntry[] = [];
    // (already stripped from dedicated days above)

    for (const ext of extensions) {
      const assignedDay = dayByExtension.get(ext) ?? nearbyDay;
      const extPool = nearbyPool.filter(
        (p) => placeMatchesNearbyExtension(p, [ext]) === ext,
      );
      const mergedNearby: AssemblyDayPlanEntry[] = [];
      for (const entry of collectedByExt.get(ext) ?? []) {
        const id = entryPlaceId(entry);
        if (!id || mergedNearby.some((e) => entryPlaceId(e) === id)) continue;
        mergedNearby.push(entry);
        usedIds.add(id);
      }
      for (const place of extPool) {
        if (mergedNearby.length >= NEARBY_EXTENSION_MAX_STOPS) break;
        const id = placeId(place) || place.name;
        if (!id || mergedNearby.some((e) => entryPlaceId(e) === id)) continue;
        if (
          identityKeys(place).some((k) => usedIds.has(k)) &&
          !mergedNearby.some((e) => entryPlaceId(e) === id)
        ) {
          continue;
        }
        mergedNearby.push({
          time: "11:00",
          label: "景點",
          name: place.name,
          place: {
            ...place,
            destinationScope: "nearby_extension",
            extensionDestination: ext,
          },
        });
        for (const key of identityKeys(place)) usedIds.add(key);
        usedIds.add(id);
      }

      // Dedicated day: ONLY nearby stops — never pad with Tokyo primary places
      plans = plans.map((plan) =>
        plan.day === assignedDay ? { ...plan, entries: mergedNearby } : plan,
      );

      logNearbyExtensionDayAllocation({
        extension: ext,
        assignedDay,
        minimumStops: NEARBY_EXTENSION_MIN_STOPS,
        selectedStops: mergedNearby.length,
      });
      logNearbyExtensionPlannerResult({
        extension: ext,
        plannedStops: mergedNearby.length,
        droppedStops: Math.max(0, extPool.length - mergedNearby.length),
        dropReasons:
          mergedNearby.length < nearbyDayMin
            ? ["nearby_extension_insufficient"]
            : [],
      });
      logAiPipeline(
        "[AI_PLANNER_NEARBY_DAY]",
        `day=${assignedDay}`,
        `extension=${ext}`,
        `nearbyCount=${mergedNearby.length}`,
        `dedicated=true`,
        `names=${mergedNearby.map((e) => e.name).join("|")}`,
      );
    }

    void displacedPrimary;
    void extensionByDay;
  }

  // ── 2) 移出明顯跨區點：相對當日錨點過遠 → 改排其他天或跳過 ──
  // Dedicated nearby days are already pure; do not compare their stops against Tokyo anchors.
  {
    const displaced: AssemblyDayPlanEntry[] = [];
    plans = plans.map((plan) => {
      const diag = diagnosticsMap.get(plan.day)!;
      if (extensions.length && dedicatedNearbyDays.has(plan.day)) return plan;
      const centroid = computeDayCentroid(plan.entries.map((e) => e.place));
      if (!centroid || plan.entries.length <= 1) return plan;
      const keep: AssemblyDayPlanEntry[] = [];
      for (const entry of plan.entries) {
        if (!hasCoords(entry.place)) {
          keep.push(entry);
          continue;
        }
        const d = distanceMeters(
          { lat: entry.place.lat!, lng: entry.place.lng! },
          centroid,
        );
        // 近郊點不應留在東京日
        if (extensions.length && placeMatchesNearbyExtension(entry.place, extensions)) {
          diag.skipped.push({ name: entry.name, reason: "nearby_reserved_other_day" });
          logSkip(plan.day, entry.name, "nearby_reserved_other_day");
          displaced.push(entry);
          usedIds.delete(entryPlaceId(entry));
          continue;
        }
        if (d > PLANNER_DAY_ANCHOR_RADIUS_M * 1.35) {
          diag.skipped.push({ name: entry.name, reason: "route_too_far" });
          logSkip(plan.day, entry.name, "route_too_far");
          displaced.push(entry);
          usedIds.delete(entryPlaceId(entry));
          continue;
        }
        keep.push(entry);
      }
      return { ...plan, entries: keep };
    });

    // 將 displaced 依地理簇／錨點距離塞回適合的天（仍不重排推薦分數）
    for (const entry of displaced) {
      let bestDay = -1;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const plan of plans) {
        const matched = placeMatchesNearbyExtension(entry.place, extensions);
        if (extensions.length && matched) {
          const assigned = dayByExtension.get(matched) ?? nearbyDay;
          if (plan.day !== assigned) continue;
        } else if (extensions.length && dedicatedNearbyDays.has(plan.day)) {
          continue;
        }
        const centroid = computeDayCentroid(plan.entries.map((e) => e.place));
        const d = centroid && hasCoords(entry.place)
          ? distanceMeters(
              { lat: entry.place.lat!, lng: entry.place.lng! },
              centroid,
            )
          : Number.POSITIVE_INFINITY;
        if (d < bestDist && d <= PLANNER_DAY_ANCHOR_RADIUS_M) {
          bestDist = d;
          bestDay = plan.day;
        }
      }
      if (bestDay < 0) {
        // 找不到合理天：留給容量補齊池
        continue;
      }
      plans = plans.map((plan) => {
        if (plan.day !== bestDay) return plan;
        const id = entryPlaceId(entry);
        if (plan.entries.some((e) => entryPlaceId(e) === id)) return plan;
        usedIds.add(id);
        return { ...plan, entries: [...plan.entries, entry] };
      });
    }
  }

  // ── 3) 最低容量：先達 min，再依賴既有 slot／節奏 ──
  const isUnused = (p: PlaceResult): boolean =>
    identityKeys(p).every((k) => !usedIds.has(k));

  const unusedInOrder = params.pool.filter(isUnused);

  for (const plan of plans) {
    const diag = diagnosticsMap.get(plan.day)!;
    const isDedicatedNearby = dedicatedNearbyDays.has(plan.day);
    const dayExt = extensionByDay.get(plan.day);
    const dayMin =
      extensions.length && isDedicatedNearby ? Math.max(nearbyDayMin, 2) : minPerDay;
    if (plan.entries.length >= dayMin) continue;

    const centroid =
      computeDayCentroid(plan.entries.map((e) => e.place)) ??
      (dayExt ? resolveDestinationApproxCenter(dayExt) : null);

    diag.capacityFallbackTriggered = true;
    capacityFallbackTriggered = true;
    logAiPipeline(
      "[AI_PLANNER_MIN_CAPACITY_FALLBACK]",
      `day=${plan.day}`,
      `have=${plan.entries.length}`,
      `need=${dayMin}`,
    );

    for (const place of unusedInOrder) {
      if (plan.entries.length >= dayMin) break;
      if (!isUnused(place)) continue;
      const id = placeId(place) || place.name;
      if (!id) continue;

      const matchedExt = placeMatchesNearbyExtension(place, extensions);
      const isNearby = Boolean(matchedExt);
      if (extensions.length) {
        // Dedicated nearby day: only same-extension candidates; never pad with primary city
        if (isDedicatedNearby) {
          if (!matchedExt || matchedExt !== dayExt) {
            diag.skipped.push({ name: place.name, reason: "nearby_reserved_other_day" });
            continue;
          }
        } else if (isNearby) {
          diag.skipped.push({ name: place.name, reason: "nearby_reserved_other_day" });
          logSkip(plan.day, place.name, "nearby_reserved_other_day");
          continue;
        }
      }

      if (centroid && hasCoords(place)) {
        const d = distanceMeters(
          { lat: place.lat!, lng: place.lng! },
          centroid,
        );
        if (d > PLANNER_DAY_ANCHOR_RADIUS_M) {
          diag.skipped.push({ name: place.name, reason: "route_too_far" });
          logSkip(plan.day, place.name, "route_too_far");
          continue; // 繼續取池中下一個
        }
      }

      plan.entries.push({
        time: "15:00",
        label: "景點",
        name: place.name,
        place,
      });
      for (const key of identityKeys(place)) usedIds.add(key);
      usedIds.add(id);
    }
  }

  // ── 4) 仍不足時：從過滿天挪點（保底，避免單點日）──
  for (const plan of plans) {
    const dayMin =
      extensions.length && plan.day === nearbyDay ? Math.max(nearbyDayMin, 2) : minPerDay;
    if (plan.entries.length >= dayMin) continue;
    while (plan.entries.length < dayMin) {
      const donor = plans
        .filter((p) => p.day !== plan.day && p.entries.length > dayMin)
        .sort((a, b) => b.entries.length - a.entries.length)[0];
      if (!donor) break;
      const moved = donor.entries.pop();
      if (!moved) break;
      // 近郊規則：非近郊日不接收近郊點
      if (
        extensions.length &&
        plan.day !== nearbyDay &&
        placeMatchesNearbyExtension(moved.place, extensions)
      ) {
        donor.entries.push(moved);
        break;
      }
      plan.entries.push(moved);
      capacityFallbackTriggered = true;
      diagnosticsMap.get(plan.day)!.capacityFallbackTriggered = true;
    }
  }

  // ── 5) 先補齊容量，再吸收單點（順序很重要：先 absorb 會讓空日搶不到候選）──
  let candidateInsufficient = false;

  const absorbSingleton = (plan: AssemblyDayPlan): void => {
    const dayMin =
      extensions.length && plan.day === nearbyDay ? Math.max(nearbyDayMin, 2) : minPerDay;
    if (!(plan.entries.length === 1 && plan.entries.length < dayMin)) return;
    logAiPipeline(
      "[AI_PLANNER_CANDIDATE_INSUFFICIENT]",
      `day=${plan.day}`,
      `placeCount=1`,
      "action=block_singleton_day",
    );
    const lone = plan.entries.splice(0, plan.entries.length);
    const prev = plans.find((p) => p.day === plan.day - 1 && p.entries.length >= 1);
    const next = plans.find((p) => p.day === plan.day + 1 && p.entries.length >= 1);
    const any = plans.find((p) => p.day !== plan.day && p.entries.length >= 1);
    const target = prev ?? next ?? any;
    if (target) target.entries.push(...lone);
    else {
      plan.entries.push(...lone);
      candidateInsufficient = true;
    }
  };

  // 稀疏日優先補（emptiest first），避免前面的天耗盡池
  const fillOrder = [...plans].sort((a, b) => a.entries.length - b.entries.length);
  for (const plan of fillOrder) {
    const dayMin =
      extensions.length && plan.day === nearbyDay ? Math.max(nearbyDayMin, 2) : minPerDay;
    if (plan.entries.length >= dayMin) continue;
    capacityFallbackTriggered = true;
    diagnosticsMap.get(plan.day)!.capacityFallbackTriggered = true;
    logAiPipeline(
      "[AI_PLANNER_MIN_CAPACITY_FALLBACK]",
      `day=${plan.day}`,
      `have=${plan.entries.length}`,
      `need=${dayMin}`,
      "phase=5b",
    );
    for (const place of params.pool) {
      if (plan.entries.length >= dayMin) break;
      if (!isUnused(place)) continue;
      const id = placeId(place) || place.name;
      if (!id) continue;
      const isNearby = Boolean(placeMatchesNearbyExtension(place, extensions));
      if (extensions.length && plan.day !== nearbyDay && isNearby) continue;
      if (extensions.length && plan.day === nearbyDay && !isNearby && plan.entries.length >= 2) {
        continue;
      }
      plan.entries.push({
        time: "15:30",
        label: "景點",
        name: place.name,
        place,
      });
      for (const key of identityKeys(place)) usedIds.add(key);
      usedIds.add(id);
    }
    while (plan.entries.length < dayMin) {
      const donor = plans
        .filter((p) => {
          if (p.day === plan.day) return false;
          const donorMin =
            extensions.length && p.day === nearbyDay
              ? Math.max(nearbyDayMin, 2)
              : dayMin;
          return p.entries.length > donorMin;
        })
        .sort((a, b) => b.entries.length - a.entries.length)[0];
      if (!donor) break;
      const moved = donor.entries.pop();
      if (!moved) break;
      if (
        extensions.length &&
        plan.day !== nearbyDay &&
        placeMatchesNearbyExtension(moved.place, extensions)
      ) {
        donor.entries.push(moved);
        break;
      }
      plan.entries.push(moved);
    }
  }

  // 補完仍單點 → 合併到鄰近日（不得丟棄）
  for (const plan of plans) absorbSingleton(plan);
  for (const plan of plans) {
    const dayMin =
      extensions.length && plan.day === nearbyDay ? Math.max(nearbyDayMin, 2) : minPerDay;
    if (plan.entries.length === 0 || plan.entries.length < Math.min(2, dayMin)) {
      candidateInsufficient = true;
    }
  }

  // ── 6) 同日 NN 路線排序 + 診斷 ──
  plans = plans.map((plan) => {
    const diag = diagnosticsMap.get(plan.day)!;
    logAiPipeline(
      "[AI_PLANNER_DAY_ASSIGN_COUNT]",
      `day=${plan.day}`,
      `count=${plan.entries.length}`,
    );
    const routed = reorderDayEntriesByRoute(plan.entries);
    for (const leg of routed.longLegs) {
      logAiPipeline(
        "[AI_PLANNER_ROUTE_LONG_LEG]",
        `day=${plan.day}`,
        `from=${leg.from}`,
        `to=${leg.to}`,
        `meters=${leg.meters}`,
      );
    }
    const places = routed.entries.map((e) => e.place);
    diag.finalPlaceCount = routed.entries.length;
    diag.adjacentDistancesM = routed.adjacentDistancesM;
    diag.areas = [...new Set(places.map(areaLabelForPlace))];
    diag.coords = places.filter(hasCoords).map((p) => ({
      name: p.name,
      lat: p.lat!,
      lng: p.lng!,
    }));
    logAiPipeline(
      "[AI_PLANNER_DAY_ROUTE]",
      `day=${plan.day}`,
      `placeCount=${diag.finalPlaceCount}`,
      `areas=${diag.areas.join("|")}`,
      `legsM=${diag.adjacentDistancesM.join(",")}`,
      `capacityFallback=${diag.capacityFallbackTriggered}`,
    );
    return { ...plan, entries: routed.entries };
  });

  // 總量不足
  const total = plans.reduce((n, p) => n + p.entries.length, 0);
  if (total < safeDays * Math.min(minPerDay, 2)) {
    candidateInsufficient = true;
    logAiPipeline(
      "[AI_PLANNER_CANDIDATE_INSUFFICIENT]",
      `total=${total}`,
      `need=${safeDays * minPerDay}`,
      `pool=${params.pool.length}`,
    );
  }

  const diagnostics = [...diagnosticsMap.values()];
  logAiPipeline(
    "[AI_PLANNER_ASSEMBLY_SUMMARY]",
    `days=${safeDays}`,
    `counts=${diagnostics.map((d) => d.finalPlaceCount).join(",")}`,
    `capacityFallback=${capacityFallbackTriggered}`,
    `candidateInsufficient=${candidateInsufficient}`,
  );

  return {
    plans: ensureDays(plans, safeDays),
    diagnostics,
    candidateInsufficient,
    capacityFallbackTriggered,
  };
}

/**
 * 依地理鄰近建議每日候選子集（保留 Engine 相對順序；不做推薦重排）。
 * 供 themed／slot pick 當 Route 偏好池。
 */
export function buildDayPreferredPools(
  pool: PlaceResult[],
  days: number,
  nearbyExtensions?: string[],
): Map<number, PlaceResult[]> {
  const safeDays = Math.max(1, days);
  const map = new Map<number, PlaceResult[]>();
  for (let d = 1; d <= safeDays; d += 1) map.set(d, []);

  const extensions = (nearbyExtensions ?? [])
    .map((e) => normalizeDestinationLabel(e))
    .filter(Boolean);
  const { nearby, primary } = partitionNearbyExtensionPlaces(pool, extensions);
  const dayByExtension = allocateNearbyExtensionDays(safeDays, extensions);
  const dedicatedDays = new Set(dayByExtension.values());

  for (const [ext, day] of dayByExtension) {
    const extPlaces = nearby.filter(
      (p) => placeMatchesNearbyExtension(p, [ext]) === ext,
    );
    if (extPlaces.length) map.set(day, [...extPlaces]);
  }

  // 簡易貪婪分群：依 Engine 順序放入與當前簇中心最近、且未滿的天
  const dayBuckets: PlaceResult[][] = Array.from({ length: safeDays }, () => []);
  const centroids: Array<{ lat: number; lng: number } | null> = Array.from(
    { length: safeDays },
    () => null,
  );
  const primaryDays = Array.from({ length: safeDays }, (_, i) => i + 1).filter(
    (d) => !dedicatedDays.has(d),
  );
  if (!primaryDays.length) {
    for (let d = 1; d <= safeDays; d += 1) primaryDays.push(d);
  }

  for (const place of primary) {
    if (!hasCoords(place)) {
      const lightest = primaryDays.reduce((best, day) =>
        dayBuckets[day - 1]!.length < dayBuckets[best - 1]!.length ? day : best,
      );
      dayBuckets[lightest - 1]!.push(place);
      continue;
    }
    let bestDay = primaryDays[0]!;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const day of primaryDays) {
      const c = centroids[day - 1];
      if (!c) {
        // 空日優先給第一個未定中心的天
        if (dayBuckets[day - 1]!.length === 0) {
          bestDay = day;
          bestDist = -1;
          break;
        }
        continue;
      }
      const d = distanceMeters({ lat: place.lat!, lng: place.lng! }, c);
      // 略偏好尚未過滿的天
      const loadPenalty = dayBuckets[day - 1]!.length * 400;
      if (d + loadPenalty < bestDist) {
        bestDist = d + loadPenalty;
        bestDay = day;
      }
    }
    dayBuckets[bestDay - 1]!.push(place);
    centroids[bestDay - 1] = computeDayCentroid(dayBuckets[bestDay - 1]!);
  }

  for (let i = 0; i < safeDays; i += 1) {
    const day = i + 1;
    if (dedicatedDays.has(day) && (map.get(day)?.length ?? 0) > 0) {
      continue;
    }
    if (!dedicatedDays.has(day)) {
      const existing = map.get(day) ?? [];
      map.set(day, [...existing, ...dayBuckets[i]!]);
    }
  }

  for (const [day, places] of map) {
    logAiPipeline(
      "[AI_PLANNER_DAY_POOL]",
      `day=${day}`,
      `count=${places.length}`,
      `areas=${[...new Set(places.map(areaLabelForPlace))].join("|")}`,
    );
  }

  return map;
}

/** 候選是否可接受進入某日（Route Constraint） */
export function passesDayRouteConstraint(params: {
  place: PlaceResult;
  dayPlaces: PlaceResult[];
  day: number;
  nearbyExtensions?: string[];
  nearbyDay?: number;
  tripDays?: number;
}): { ok: boolean; reason?: PlannerSkipReason } {
  const { place, dayPlaces, day, nearbyExtensions = [] } = params;
  const extensions = nearbyExtensions
    .map((e) => normalizeDestinationLabel(e))
    .filter(Boolean);
  const dayByExtension = allocateNearbyExtensionDays(
    params.tripDays ?? Math.max(day, 1),
    extensions,
  );
  const dedicatedDays = new Set(dayByExtension.values());
  const nearbyDay =
    params.nearbyDay ?? resolveNearbyExtensionDay(params.tripDays ?? Math.max(day, 1));
  const matchedExt = placeMatchesNearbyExtension(place, extensions);
  const isNearby = Boolean(matchedExt);

  if (extensions.length) {
    if (isNearby && matchedExt) {
      const assigned = dayByExtension.get(matchedExt) ?? nearbyDay;
      if (day !== assigned) {
        return { ok: false, reason: "nearby_reserved_other_day" };
      }
      // Within dedicated nearby day: only check distance vs same-extension stops
      if (!hasCoords(place)) return { ok: true };
      const centroid = computeDayCentroid(dayPlaces);
      if (!centroid || dayPlaces.length === 0) return { ok: true };
      const d = distanceMeters(
        { lat: place.lat!, lng: place.lng! },
        centroid,
      );
      if (d > PLANNER_DAY_ANCHOR_RADIUS_M * 1.5) {
        return { ok: false, reason: "route_too_far" };
      }
      return { ok: true };
    }
    if (dedicatedDays.has(day) && !isNearby) {
      return { ok: false, reason: "nearby_reserved_other_day" };
    }
  }

  if (!hasCoords(place)) return { ok: true };
  const centroid = computeDayCentroid(dayPlaces);
  if (!centroid || dayPlaces.length === 0) return { ok: true };

  const d = distanceMeters(
    { lat: place.lat!, lng: place.lng! },
    centroid,
  );
  if (d > PLANNER_DAY_ANCHOR_RADIUS_M) {
    return { ok: false, reason: "route_too_far" };
  }
  return { ok: true };
}
