import type {
  RoamieItineraryItem,
  RoamiePayloadV2,
  RoamieRecommendationItem,
} from "@/lib/ai/types";
import { normalizeItineraryItem } from "@/lib/ai/types";
import { resolveDestinationApproxCenter } from "@/lib/ai/destination-geocode";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { INSUFFICIENT_ITINERARY_PLACES_MESSAGE } from "@/lib/ai/generic-place-label";
import { listTripDates } from "@/lib/outfit/group-by-date";
import { buildMixedItineraryWithDiagnostics } from "@/lib/trip/mixed-itinerary-schedule";
import {
  groupStopsByTripDays,
  redistributeToFillEmptyDays,
  validateGeneratedItinerary,
} from "@/lib/ai/combination-itinerary-integrity";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  computeMinimumPlacesForTripDays,
  SELECTED_COMBINATION_FILLER_POLICY,
  validateItineraryPreSave,
} from "@/lib/ai/real-place-supplement";
import { minEffectivePlacesPerDay } from "@/lib/ai/planner-day-route-assembly";

export const ITINERARY_GENERATION_FAILED_MESSAGE = "行程建立失敗，我再幫你重新整理一次。";

export const ITINERARY_PARTIAL_FAILURE_MESSAGE = "行程建立失敗，是否改成列出必去景點？";

export type ItineraryDayPlan = {
  day: number;
  date?: string;
  stops: RoamieItineraryItem[];
};

export type GenerateItinerarySuccess = {
  success: true;
  trip: {
    id: string;
    title: string;
    destination: string;
    days: number;
    itinerary: ItineraryDayPlan[];
    payload: RoamiePayloadV2;
  };
};

export type GenerateItineraryFailure = {
  success: false;
  errorCode: string;
  message: string;
  failureReason?: string;
  failedRules?: string[];
  diagnostics?: {
    affectedDays?: number[];
    dayCount?: number;
    stopCount?: number;
    details?: string[];
  };
};

export type GenerateItineraryResult = GenerateItinerarySuccess | GenerateItineraryFailure;

const GENERATE_ITINERARY_RESULT_ENVELOPE_KEYS = ["data", "result", "payload", "response"] as const;

// TanStack Start serializes server-function middleware output as
// { result, error, context }. In the bundled/native boundary that transport
// context can be retained inside the client middleware result once more.
const GENERATE_ITINERARY_RESULT_FIXED_PATHS = [["result", "result"]] as const;

type GenerateItineraryNormalizedKind = "success" | "failure" | "invalid";

export type GenerateItineraryRawShape = {
  rawType: string;
  isArray: boolean;
  topLevelKeys: string[];
  knownEnvelopeKeys: string[];
  level1Keys: string[];
  level2Keys: string[];
  successPath: string;
  errorCodePath: string;
  payloadPath: string;
  normalizedKind: GenerateItineraryNormalizedKind;
};

const FALLBACK_STOP_TIMES = ["09:30", "11:30", "14:30", "18:00"];

const DAY_FILLER_TEMPLATES: { title: string; time: string; description: string }[] = [
  { title: "市區自由探索", time: "10:00", description: "保留彈性，可依體力調整節奏。" },
  { title: "在地咖啡廳與散步", time: "14:30", description: "慢步調認識當地街區。" },
  { title: "移動日 · 轉換區域", time: "09:00", description: "安排交通與行李，轉往下一區。" },
  { title: "半日休息 · 自由活動", time: "11:00", description: "可補眠、購物或調整前幾天節奏。" },
  { title: "近郊探索", time: "09:30", description: "依天氣選擇輕量戶外或市區延伸。" },
  { title: "當地餐廳與夜景", time: "17:30", description: "體驗在地飲食與夜間氛圍。" },
];

function dayIndexForPlace(placeIndex: number, placeCount: number, dayCount: number): number {
  if (placeCount <= 0 || dayCount <= 0) return 0;
  if (placeCount >= dayCount) return Math.min(placeIndex, dayCount - 1);
  return Math.min(Math.floor((placeIndex * dayCount) / placeCount), dayCount - 1);
}

function makePlaceItineraryStop(
  place: RoamieRecommendationItem,
  date: string,
  time: string,
): RoamieItineraryItem {
  const placeId =
    place.googlePlaceId?.trim() ||
    (place as RoamieRecommendationItem & { placeId?: string }).placeId?.trim();
  return normalizeItineraryItem({
    date,
    time,
    title: place.name,
    placeName: place.placeName ?? place.name,
    description: place.description || place.reason || "",
    lat: place.lat,
    lng: place.lng,
    address: place.address?.trim() || place.name,
    googlePlaceId: placeId || undefined,
    placeType: place.primaryType ?? place.type,
    coordinateSource:
      placeId && place.lat != null && place.lng != null ? "google_places" : undefined,
    sourceCombinationId: place.sourceCombinationId,
    matchedCombinationIds: place.matchedCombinationIds,
    matchedSelectedCombinationIds: place.matchedSelectedCombinationIds,
    sourceRegionCandidate: place.sourceRegionCandidate,
    destinationScope: place.destinationScope,
    extensionDestination: place.extensionDestination,
    photoName: place.photoName,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    businessStatus: place.businessStatus,
    openStatusLabel: place.openStatusLabel,
    todayHoursLabel: place.todayHoursLabel,
    types: place.types?.length
      ? place.types
      : place.primaryType || place.type
        ? [place.primaryType || place.type]
        : undefined,
    placeSnapshotSource: "selected_place",
  });
}

function makeFillerItineraryStop(
  destination: string,
  date: string,
  template: (typeof DAY_FILLER_TEMPLATES)[number],
): RoamieItineraryItem {
  const label = normalizeDestinationLabel(destination);
  const approx = resolveDestinationApproxCenter(label);
  const title = `${label} · ${template.title}`;
  return normalizeItineraryItem({
    date,
    time: template.time,
    title,
    placeName: title,
    description: template.description,
    lat: approx?.lat,
    lng: approx?.lng,
    address: label,
  });
}

export function isGenerateItineraryFailure(result: unknown): result is GenerateItineraryFailure {
  if (!result || typeof result !== "object") return false;
  const record = result as Record<string, unknown>;
  return record.success === false && typeof record.errorCode === "string";
}

function isGenerateItinerarySuccess(result: unknown): result is GenerateItinerarySuccess {
  if (!result || typeof result !== "object") return false;
  const record = result as Record<string, unknown>;
  return record.success === true && Boolean(record.trip && typeof record.trip === "object");
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sortedKeys(value: unknown): string[] {
  const record = objectRecord(value);
  return record ? Object.keys(record).sort().slice(0, 24) : [];
}

function knownResultPath(raw: unknown): { path: string; value: unknown } | null {
  if (isGenerateItineraryFailure(raw) || isGenerateItinerarySuccess(raw)) {
    return { path: "$", value: raw };
  }
  const envelope = objectRecord(raw);
  if (!envelope) return null;

  for (const key of GENERATE_ITINERARY_RESULT_ENVELOPE_KEYS) {
    const candidate = envelope[key];
    if (isGenerateItineraryFailure(candidate) || isGenerateItinerarySuccess(candidate)) {
      return { path: key, value: candidate };
    }
  }
  for (const [first, second] of GENERATE_ITINERARY_RESULT_FIXED_PATHS) {
    const level1 = objectRecord(envelope[first]);
    const candidate = level1?.[second];
    if (isGenerateItineraryFailure(candidate) || isGenerateItinerarySuccess(candidate)) {
      return { path: `${first}.${second}`, value: candidate };
    }
  }
  return null;
}

/** Safe boundary telemetry: records shape and known paths, never values. */
export function describeGenerateItineraryRawShape(
  raw: unknown,
  normalized: GenerateItineraryResult | null,
): GenerateItineraryRawShape {
  const envelope = objectRecord(raw);
  const knownEnvelopeKeys = GENERATE_ITINERARY_RESULT_ENVELOPE_KEYS.filter(
    (key) => envelope && key in envelope,
  );
  const firstKnownValue = knownEnvelopeKeys.length ? envelope?.[knownEnvelopeKeys[0]] : undefined;
  const level1 = objectRecord(firstKnownValue);
  const matched = knownResultPath(raw);
  const matchedRecord = objectRecord(matched?.value);
  const matchedPath = matched?.path ?? "";
  const successPath = matchedRecord && "success" in matchedRecord ? `${matchedPath}.success` : "";
  const errorCodePath =
    matchedRecord && "errorCode" in matchedRecord ? `${matchedPath}.errorCode` : "";
  const trip = objectRecord(matchedRecord?.trip);
  const payloadPath = trip && "payload" in trip ? `${matchedPath}.trip.payload` : "";

  return {
    rawType: raw === null ? "null" : typeof raw,
    isArray: Array.isArray(raw),
    topLevelKeys: sortedKeys(raw),
    knownEnvelopeKeys: [...knownEnvelopeKeys],
    level1Keys: sortedKeys(firstKnownValue),
    level2Keys: sortedKeys(level1?.result),
    successPath,
    errorCodePath,
    payloadPath,
    normalizedKind: isGenerateItineraryFailure(normalized)
      ? "failure"
      : isGenerateItinerarySuccess(normalized)
        ? "success"
        : "invalid",
  };
}

/** Normalize direct results plus explicitly supported transport-envelope paths. */
export function normalizeGenerateItineraryResult(raw: unknown): GenerateItineraryResult | null {
  const matched = knownResultPath(raw);
  if (!matched) return null;
  return matched.value as GenerateItineraryResult;
}

export function groupItineraryItemsByDay(
  items: RoamieItineraryItem[],
  startDate?: string,
): ItineraryDayPlan[] {
  const stops = coalesceItineraryItems(items);
  if (!stops.length) return [];

  const dateOrder: string[] = [];
  for (const item of stops) {
    const date = item.date?.trim();
    if (date && !dateOrder.includes(date)) dateOrder.push(date);
  }
  if (!dateOrder.length && startDate?.trim()) {
    dateOrder.push(startDate.trim());
  }

  const buckets = new Map<string, RoamieItineraryItem[]>();
  for (const item of stops) {
    const date = item.date?.trim() || dateOrder[0] || startDate || "";
    const list = buckets.get(date) ?? [];
    list.push(item);
    buckets.set(date, list);
  }

  const orderedDates = dateOrder.length ? dateOrder : [...buckets.keys()];

  return orderedDates.map((date, index) => ({
    day: index + 1,
    date,
    stops: buckets.get(date) ?? [],
  }));
}

/** 從已選地點建立保底行程 — 候選不足時保留空日並讓後續驗證擋下儲存，禁止單點日補洞 */
export function buildFallbackItineraryFromPlaces(
  selectedPlaces: RoamieRecommendationItem[],
  days: number,
  startDate: string,
  destination?: string,
  opts?: {
    selectedCombinationIds?: number[];
    nearbyExtensions?: string[];
    pace?: "slow" | "medium" | "active";
  },
): RoamieItineraryItem[] {
  const dayCount = Math.max(days, 1);
  const pace = opts?.pace ?? "medium";
  const minPerDay = minEffectivePlacesPerDay(pace);
  const selectedCombinationIds =
    opts?.selectedCombinationIds ??
    [
      ...new Set(
        selectedPlaces
          .flatMap(
            (p) =>
              p.matchedSelectedCombinationIds ??
              (p.sourceCombinationId != null ? [p.sourceCombinationId] : []),
          )
          .filter((id): id is number => typeof id === "number" && id > 0),
      ),
    ].sort((a, b) => a - b);

  const mixedResult = buildMixedItineraryWithDiagnostics(
    selectedPlaces,
    days,
    startDate,
    destination,
    {
      selectedCombinationIds,
      nearbyExtensions: opts?.nearbyExtensions,
      pace: opts?.pace,
    },
  );

  logAiPipeline(
    "[FALLBACK_ITINERARY_DIAG]",
    `dayCounts=${mixedResult.dayCounts.join(",")}`,
    `candidateInsufficient=${mixedResult.candidateInsufficient}`,
    `requiredCount=${mixedResult.requiredCount}`,
    `availableCount=${mixedResult.availableCount}`,
    `missingCount=${mixedResult.missingCount}`,
    `affectedDays=[${mixedResult.affectedDays.join(",")}]`,
    "sourceFunction=buildFallbackItineraryFromPlaces",
  );

  // candidateInsufficient：禁止 redistribute／spare 單點填空，保留 Planner 空日給 integrity 擋下。
  if (mixedResult.candidateInsufficient) {
    logAiPipeline(
      "[CANDIDATE_INSUFFICIENT_BLOCK_SAVE]",
      `requiredCount=${mixedResult.requiredCount}`,
      `availableCount=${mixedResult.availableCount}`,
      `missingCount=${mixedResult.missingCount}`,
      `affectedDays=[${mixedResult.affectedDays.join(",")}]`,
      `replanReasons=${mixedResult.replanReasons.join("|")}`,
      "action=skip_redistribute_and_singleton_fill",
    );
    return mixedResult.stops;
  }

  const filled = redistributeToFillEmptyDays({
    stops: mixedResult.stops,
    days: dayCount,
    startDate,
    sparePlaces: selectedPlaces,
    makeStop: (place, date, time) => makePlaceItineraryStop(place, date, time),
    minPerDay,
    forbidSingletonFill: true,
  });

  const dates = listTripDates([], startDate, dayCount);
  const destLabel = destination?.trim() ? normalizeDestinationLabel(destination) : "";
  const stops = [...filled];
  const occupied = new Set(stops.map((s) => s.date?.trim()).filter(Boolean));

  // Never invent synthetic / singleton fillers. Real-place supplement must run earlier.
  for (const date of dates) {
    if (occupied.has(date)) continue;
    const usedKeys = new Set(
      stops.map(
        (s) =>
          s.googlePlaceId?.trim() ||
          `${(s.placeName ?? s.title).replace(/\s+/g, "").toLowerCase()}`,
      ),
    );
    const spares = selectedPlaces.filter((p) => {
      const key =
        p.googlePlaceId?.trim() || `${(p.placeName ?? p.name).replace(/\s+/g, "").toLowerCase()}`;
      return key && !usedKeys.has(key);
    });
    // Only fill empty day with ≥ minPerDay unused places — never a singleton.
    if (spares.length >= minPerDay) {
      for (let i = 0; i < minPerDay; i += 1) {
        stops.push(makePlaceItineraryStop(spares[i]!, date, i === 0 ? "10:00" : "14:00"));
      }
      occupied.add(date);
      continue;
    }
    logAiPipeline(
      "[DAY_FILLER_SKIPPED]",
      `date=${date}`,
      selectedCombinationIds.length > 0 && !SELECTED_COMBINATION_FILLER_POLICY.allowSynthetic
        ? "reason=selected_combinations_forbid_synthetic_filler"
        : "reason=forbid_singleton_or_synthetic_empty_day_fill",
      `spare=${spares.length}`,
      `need=${minPerDay}`,
      destLabel ? `destination=${destLabel}` : "",
    );
    logAiPipeline("[EMPTY_DAY_BLOCKED]", `date=${date}`, "reason=no_places_and_not_free_day");
  }

  if (stops.length < computeMinimumPlacesForTripDays(dayCount)) {
    logAiPipeline(
      "[INSUFFICIENT_REAL_PLACES_DETECTED]",
      `tripDays=${dayCount}`,
      `resolvedPlaces=${stops.length}`,
      `minimumRequired=${computeMinimumPlacesForTripDays(dayCount)}`,
      "stage=fallback_build",
    );
  }

  const grouped = groupStopsByTripDays(stops, dayCount, startDate);
  const validation = validateGeneratedItinerary({
    tripDays: dayCount,
    startDate,
    selectedCombinationIds,
    days: grouped,
    resolvedPlaces: selectedPlaces,
  });
  if (!validation.ok) {
    logAiPipeline("[ITINERARY_INTEGRITY_WARN]", `reasons=${validation.reasons.join("|")}`);
  }

  const preSave = validateItineraryPreSave({
    tripDays: dayCount,
    startDate,
    stops,
  });
  if (!preSave.ok) {
    logAiPipeline(
      "[ITINERARY_PRE_SAVE_VALIDATION]",
      `days=${preSave.days}`,
      `stops=${preSave.stops}`,
      `emptyNonFreeDays=[${preSave.emptyNonFreeDays.join(",")}]`,
      `invalidStops=${preSave.invalidStops.length}`,
      `reasons=${preSave.reasons.join("|")}`,
    );
  }

  if (stops.length > 0) {
    return stops.sort((a, b) => {
      const dateCmp = (a.date ?? "").localeCompare(b.date ?? "");
      if (dateCmp !== 0) return dateCmp;
      return (a.time ?? "").localeCompare(b.time ?? "");
    });
  }

  const legacyStops: RoamieItineraryItem[] = [];
  const dayOccupied = new Array<boolean>(dayCount).fill(false);

  selectedPlaces.forEach((place, idx) => {
    // Spread across days instead of dumping overflow on the last day.
    const dayIdx =
      selectedPlaces.length >= dayCount
        ? idx % dayCount
        : dayIndexForPlace(idx, selectedPlaces.length, dayCount);
    const date = dates[dayIdx] ?? startDate;
    dayOccupied[dayIdx] = true;
    legacyStops.push(
      makePlaceItineraryStop(
        place,
        date,
        FALLBACK_STOP_TIMES[idx % FALLBACK_STOP_TIMES.length] ?? "09:30",
      ),
    );
  });

  for (let d = 0; d < dayCount; d += 1) {
    if (dayOccupied[d]) continue;
    const template = DAY_FILLER_TEMPLATES[d % DAY_FILLER_TEMPLATES.length]!;
    const date = dates[d] ?? startDate;
    legacyStops.push(
      destLabel
        ? makeFillerItineraryStop(destLabel, date, template)
        : normalizeItineraryItem({
            date,
            time: template.time,
            title: template.title,
            placeName: template.title,
            description: template.description,
          }),
    );
  }

  return legacyStops.sort((a, b) => {
    const dateCmp = (a.date ?? "").localeCompare(b.date ?? "");
    if (dateCmp !== 0) return dateCmp;
    return (a.time ?? "").localeCompare(b.time ?? "");
  });
}

export { validateGeneratedItinerary };

/** 安全讀取 itinerary — 禁止直接存取可能為 undefined 的 .itinerary */
export function coalesceItineraryItems(value: unknown): RoamieItineraryItem[] {
  return Array.isArray(value) ? value : [];
}

export function normalizeTripPayload(
  payload: Partial<RoamiePayloadV2> & Record<string, unknown>,
): RoamiePayloadV2 {
  const itinerary = coalesceItineraryItems(payload.itinerary);
  return {
    ...payload,
    title: typeof payload.title === "string" ? payload.title : "",
    summary: typeof payload.summary === "string" ? payload.summary : "",
    moodTag: typeof payload.moodTag === "string" ? payload.moodTag : "",
    recommendations: Array.isArray(payload.recommendations) ? payload.recommendations : [],
    itinerary,
    version: 2,
  } as RoamiePayloadV2;
}

/** 解析 generateItinerary 回傳 — 支援 success/trip、{ itinerary } 或直接 payload */
export function unwrapGeneratedTripPayload(result: unknown): RoamiePayloadV2 | null {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;

  if (record.success === false) return null;

  if (record.success === true && record.trip && typeof record.trip === "object") {
    const trip = record.trip as Record<string, unknown>;
    if (trip.payload && typeof trip.payload === "object") {
      return normalizeTripPayload(trip.payload as Partial<RoamiePayloadV2>);
    }
  }

  if (
    record.itinerary &&
    typeof record.itinerary === "object" &&
    !Array.isArray(record.itinerary)
  ) {
    return normalizeTripPayload(record.itinerary as Partial<RoamiePayloadV2>);
  }

  if ("summary" in record || "title" in record || record.version === 2) {
    return normalizeTripPayload(record as Partial<RoamiePayloadV2>);
  }

  return null;
}

export function hasValidItineraryStops(
  payload: Pick<RoamiePayloadV2, "itinerary">,
  minStops = 1,
): boolean {
  const items = coalesceItineraryItems(payload.itinerary);
  if (items.length < minStops) {
    logAiPipeline(
      "[STOP_VALIDATION_FAILED]",
      "index=-1",
      "name=",
      `missingFields=[stop_count]`,
      `invalidFields=[]`,
      `detail=got=${items.length},min=${minStops}`,
    );
    return false;
  }
  return items.every((item, index) => {
    const name = (item.placeName ?? item.title)?.trim();
    if (!name) {
      logAiPipeline(
        "[STOP_VALIDATION_FAILED]",
        `index=${index}`,
        "name=",
        "missingFields=[name]",
        "invalidFields=[]",
      );
      return false;
    }
    const hasId = Boolean(item.googlePlaceId?.trim());
    const hasCoords =
      item.lat != null &&
      item.lng != null &&
      (Math.abs(item.lat) > 0.001 || Math.abs(item.lng) > 0.001);
    if (!hasId && !hasCoords) {
      logAiPipeline(
        "[STOP_VALIDATION_FAILED]",
        `index=${index}`,
        `name=${name}`,
        "missingFields=[googlePlaceId,coordinates]",
        "invalidFields=[]",
      );
      return false;
    }
    return true;
  });
}

/** Full pre-save gate used by the state machine (days + schema + empty non-free days). */
export function hasCompleteItineraryPayload(
  payload: Pick<RoamiePayloadV2, "itinerary">,
  tripDays: number,
  startDate: string,
): boolean {
  const items = coalesceItineraryItems(payload.itinerary);
  const preSave = validateItineraryPreSave({
    tripDays,
    startDate,
    stops: items,
  });
  if (!preSave.ok) {
    logAiPipeline(
      "[ITINERARY_VALIDATION_RESULT]",
      "invalid",
      `detail=${preSave.reasons.join("|")}`,
    );
    return false;
  }
  return hasValidItineraryStops(payload, computeMinimumPlacesForTripDays(tripDays));
}

export function formatItineraryUserError(error: unknown): string {
  if (error instanceof ItineraryGenerationError) {
    return error.message;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (
    /undefined is not an object/i.test(message) ||
    /cannot read propert/i.test(message) ||
    /is not iterable/i.test(message) ||
    /\.itinerary/.test(message)
  ) {
    return ITINERARY_GENERATION_FAILED_MESSAGE;
  }
  if (
    message.includes(INSUFFICIENT_ITINERARY_PLACES_MESSAGE) ||
    /找不到足夠/.test(message) ||
    /insufficient/i.test(message)
  ) {
    return "目前還沒找到足夠的實際地點，我再幫你換一批。";
  }
  if (message.trim()) return message;
  return ITINERARY_GENERATION_FAILED_MESSAGE;
}

export class ItineraryGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ItineraryGenerationError";
  }
}
