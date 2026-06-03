import { isRoamiePayloadV2, type RoamiePayloadV2 } from "@/lib/ai/types";
import type { Itinerary } from "@/lib/itinerary.functions";

const VOLATILE_PAYLOAD_KEYS = new Set([
  "generatedAt",
  "savedAt",
  "outfitAdviceInputKey",
  "outfitSuggestionUpdatedAt",
  "outfitSuggestionInputKey",
]);

function sortRecordKeys<T>(record: Record<string, T> | undefined): Record<string, T> | undefined {
  if (!record) return undefined;
  return Object.fromEntries(Object.keys(record).sort().map((k) => [k, record[k]!]));
}

/** 寫入比對用：移除僅時間戳／快取 key 等易觸發假 diff 的欄位 */
export function normalizeTripPayloadForCompare(
  payload: Itinerary | RoamiePayloadV2 | null | undefined,
): unknown {
  if (!payload || typeof payload !== "object") return null;
  if (!isRoamiePayloadV2(payload)) return payload;

  const outfit = payload.outfitAdvice;
  const normalizedOutfit = outfit
    ? {
        ...outfit,
        generatedAt: undefined,
        days: [...(outfit.days ?? [])].sort((a, b) =>
          `${a.date ?? ""}|${a.headline ?? ""}`.localeCompare(`${b.date ?? ""}|${b.headline ?? ""}`),
        ),
      }
    : undefined;

  const itinerary = [...(payload.itinerary ?? [])].sort((a, b) => {
    const left = `${a.date ?? ""}|${a.time ?? ""}|${a.placeName ?? ""}|${a.title ?? ""}`;
    const right = `${b.date ?? ""}|${b.time ?? ""}|${b.placeName ?? ""}|${b.title ?? ""}`;
    return left.localeCompare(right);
  });

  const settings = payload.tripSettings
    ? {
        ...payload.tripSettings,
        legMinutes: sortRecordKeys(payload.tripSettings.legMinutes),
        legTransport: sortRecordKeys(payload.tripSettings.legTransport),
        transitLegs: sortRecordKeys(payload.tripSettings.transitLegs),
      }
    : undefined;

  const base: Record<string, unknown> = {
    ...payload,
    recommendations: [],
    itinerary,
    tripSettings: settings,
    outfitAdvice: normalizedOutfit,
    outfitAdviceInputKey: undefined,
    outfitSuggestionUpdatedAt: undefined,
    outfitSuggestionInputKey: undefined,
    generatedAt: undefined,
    savedAt: undefined,
  };

  for (const key of VOLATILE_PAYLOAD_KEYS) {
    delete base[key];
  }

  return base;
}

export function tripPayloadFingerprint(
  payload: Itinerary | RoamiePayloadV2 | null | undefined,
  mood?: string | null,
): string {
  const normalized = normalizeTripPayloadForCompare(payload);
  return JSON.stringify({ mood: mood ?? null, payload: normalized });
}

export function diffTripPersistFields(
  prev: Itinerary | RoamiePayloadV2 | null | undefined,
  next: Itinerary | RoamiePayloadV2 | null | undefined,
  prevMood?: string | null,
  nextMood?: string | null,
): string[] {
  const fields: string[] = [];
  if ((prevMood ?? null) !== (nextMood ?? null)) fields.push("mood");
  if (tripPayloadFingerprint(prev, prevMood) !== tripPayloadFingerprint(next, nextMood)) {
    fields.push("payload");
  }
  return fields;
}

export function tripPayloadsEqual(
  a: Itinerary | RoamiePayloadV2 | null | undefined,
  b: Itinerary | RoamiePayloadV2 | null | undefined,
  moodA?: string | null,
  moodB?: string | null,
): boolean {
  return tripPayloadFingerprint(a, moodA) === tripPayloadFingerprint(b, moodB);
}
