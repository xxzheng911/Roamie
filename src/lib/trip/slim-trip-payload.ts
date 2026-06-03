import type { RoamieItineraryItem, RoamiePayloadV2 } from "@/lib/ai/types";
import type { OutfitAdvicePayload } from "@/lib/outfit/types";

const MAX_TEXT = 400;
const MAX_SUMMARY = 800;

function clip(text: string | undefined, max: number): string {
  const t = text?.trim() ?? "";
  if (!t) return "";
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function slimItineraryItem(item: RoamieItineraryItem): RoamieItineraryItem {
  return {
    date: item.date,
    time: item.time,
    title: clip(item.title, 120),
    placeName: clip(item.placeName, 120),
    placeType: clip(item.placeType, 40),
    address: clip(item.address, 200),
    description: clip(item.description, MAX_TEXT),
    notes: clip(item.notes, MAX_TEXT),
    lat: item.lat,
    lng: item.lng,
    googlePlaceId: item.googlePlaceId,
    googleMapsUrl: item.googleMapsUrl,
  };
}

function slimOutfitAdvice(advice: OutfitAdvicePayload | undefined): OutfitAdvicePayload | undefined {
  if (!advice?.days?.length) return undefined;
  return {
    ...advice,
    days: advice.days.map((d) => ({
      ...d,
      summary: clip(d.summary, 200),
      items: d.items?.slice(0, 8).map((i) => clip(i, 80)),
    })),
  };
}

/** 建立可寫入 DB 的精簡 payload（避免單次 jsonb 過大導致 statement timeout） */
export function slimTripPayloadForStorage(payload: RoamiePayloadV2): RoamiePayloadV2 {
  const itinerary = (payload.itinerary ?? []).map(slimItineraryItem);
  const settings = payload.tripSettings;

  return {
    version: 2,
    title: clip(payload.title, 120) || payload.title,
    summary: clip(payload.summary, MAX_SUMMARY),
    moodTag: payload.moodTag ?? "",
    destination: payload.destination,
    destinationLocation: payload.destinationLocation,
    originLocation: payload.originLocation,
    days: payload.days,
    generatedAt: payload.generatedAt,
    userSaved: payload.userSaved,
    source: payload.source,
    savedAt: payload.savedAt,
    travelers: payload.travelers,
    itinerary,
    recommendations: [],
    weatherSummary: clip(payload.weatherSummary, 300),
    aiGeneratedCoverImageUrl: payload.aiGeneratedCoverImageUrl,
    aiFallbackSource: payload.aiFallbackSource,
    fallbackReason: payload.fallbackReason,
    coreTrip: payload.coreTrip,
    outfitAdvice: slimOutfitAdvice(payload.outfitAdvice),
    outfitAdviceInputKey: payload.outfitAdviceInputKey,
    tripSettings: settings
      ? {
          startTime: settings.startTime,
          transport: settings.transport,
          tripStartDate: settings.tripStartDate,
          tripEndDate: settings.tripEndDate,
          tripDayDates: settings.tripDayDates,
          transportTips: clip(settings.transportTips, 300),
          legMinutes: settings.legMinutes,
          legTransport: settings.legTransport,
          transitLegs: settings.transitLegs,
        }
      : undefined,
  };
}

/** 僅含中繼資料的空殼行程（insert 第一階段） */
export function buildMinimalTripShellPayload(
  payload: RoamiePayloadV2,
): RoamiePayloadV2 {
  return {
    version: 2,
    title: payload.title,
    summary: clip(payload.summary, 300),
    moodTag: payload.moodTag ?? "",
    destination: payload.destination,
    destinationLocation: payload.destinationLocation,
    originLocation: payload.originLocation,
    days: payload.days,
    generatedAt: payload.generatedAt,
    userSaved: payload.userSaved,
    source: payload.source,
    savedAt: payload.savedAt,
    travelers: payload.travelers,
    itinerary: [],
    recommendations: [],
    weatherSummary: clip(payload.weatherSummary, 200),
    aiGeneratedCoverImageUrl: payload.aiGeneratedCoverImageUrl,
    coreTrip: payload.coreTrip,
    tripSettings: payload.tripSettings
      ? {
          startTime: payload.tripSettings.startTime,
          transport: payload.tripSettings.transport,
          tripStartDate: payload.tripSettings.tripStartDate,
          tripEndDate: payload.tripSettings.tripEndDate,
          tripDayDates: payload.tripSettings.tripDayDates,
        }
      : undefined,
  };
}
