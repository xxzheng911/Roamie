import type { StoredItinerary } from "@/lib/itinerary-storage";
import { getItinerary, listItineraries } from "@/lib/itinerary-storage";
import { listOwnedTripIds } from "@/lib/trip/trip-collab";
import { isRoamiePayloadV2, type RoamiePayloadV2 } from "@/lib/ai/types";
import { withCacheBust } from "@/lib/media-display-url";
import { getRoamieDefaultImage } from "@/services/placeImageService";
import { buildLegKey } from "@/lib/transit/types";

export type CoreTripPlace = {
  placeId: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  arrivalTime: string;
  duration: string;
  transportMode: string;
  pointToPointDuration: string;
};

export type CoreTrip = {
  id: string;
  title: string;
  customTitle: string | null;
  isTitleCustomized: boolean;
  coverImageUrl: string | null;
  customCoverImageUrl: string | null;
  aiGeneratedCoverImageUrl: string | null;
  isCoverCustomized: boolean;
  destinationPlace: { name: string; placeId?: string } | null;
  originPlace: { name: string; placeId?: string } | null;
  startDate: string;
  endDate: string;
  days: number;
  transportMode: string;
  places: CoreTripPlace[];
  weatherSummary: string;
  outfitSuggestion: string;
  createdAt: string;
  updatedAt: string;
  /** 是否為行程建立者（可刪除行程、管理成員） */
  isOwner: boolean;
};

export function resolveCoreTripTitle(trip: CoreTrip): string {
  return trip.isTitleCustomized && trip.customTitle ? trip.customTitle : trip.title;
}

export function resolveCoreTripCoverImage(trip: CoreTrip): string {
  return (
    trip.customCoverImageUrl?.trim() ||
    trip.aiGeneratedCoverImageUrl?.trim() ||
    getRoamieDefaultImage("roamie")
  );
}

/** 自訂封面帶 cache-bust，避免 Storage 同路徑 upsert 後瀏覽器仍顯示舊圖 */
export function resolveCoreTripCoverDisplayUrl(trip: CoreTrip): string {
  const raw = resolveCoreTripCoverImage(trip);
  if (!trip.customCoverImageUrl?.trim()) return raw;
  const parsed = Date.parse(trip.updatedAt);
  const revision = Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now();
  return withCacheBust(raw, revision) ?? raw;
}

function transportLabel(mode?: string): string {
  if (!mode) return "步行";
  if (mode === "walk") return "步行";
  if (mode === "drive") return "開車";
  if (mode === "transit") return "大眾運輸";
  if (mode === "scooter") return "機車";
  return mode;
}

function durationText(minutes?: number): string {
  if (!minutes || minutes <= 0) return "尚未設定";
  if (minutes < 60) return `${minutes} 分鐘`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} 小時 ${m} 分鐘` : `${h} 小時`;
}

export function toCoreTrip(row: StoredItinerary, opts?: { isOwner?: boolean }): CoreTrip {
  const isOwner = opts?.isOwner ?? true;
  const payload = row.payload;
  if (isRoamiePayloadV2(payload)) {
    const itinerary = payload.itinerary ?? [];
    const tripSettings = payload.tripSettings;
    return {
      id: row.id,
      title: row.title,
      customTitle: row.custom_title,
      isTitleCustomized: Boolean(row.is_title_customized),
      coverImageUrl: row.cover_image_url,
      customCoverImageUrl: row.custom_cover_image_url,
      aiGeneratedCoverImageUrl: row.cover_image,
      isCoverCustomized: Boolean(row.is_cover_customized),
      destinationPlace: payload.destinationLocation
        ? { name: payload.destinationLocation.displayLabel ?? payload.destinationLocation.city, placeId: payload.destinationLocation.placeId }
        : payload.destination
          ? { name: payload.destination }
          : null,
      originPlace: payload.originLocation
        ? { name: payload.originLocation.displayLabel ?? payload.originLocation.city, placeId: payload.originLocation.placeId }
        : null,
      startDate: payload.tripSettings?.tripStartDate ?? "",
      endDate: payload.tripSettings?.tripEndDate ?? payload.tripSettings?.tripStartDate ?? "",
      days: payload.days ?? 1,
      transportMode: transportLabel(payload.tripSettings?.transport),
      places: itinerary.map((p, index) => {
        const prev = index > 0 ? itinerary[index - 1] : null;
        const currentKey = p.placeName || p.title;
        const legKey = prev ? buildLegKey(prev.placeName || prev.title, currentKey) : "";
        const legMinutes = tripSettings?.legMinutes?.[currentKey];
        const transit = legKey ? tripSettings?.transitLegs?.[legKey] : undefined;
        return {
        placeId: p.googlePlaceId ?? "",
        name: p.placeName || p.title,
        address: p.address ?? "",
        lat: p.lat ?? null,
        lng: p.lng ?? null,
        arrivalTime: p.time?.slice(0, 5) ?? "",
        duration: durationText(legMinutes),
        transportMode:
          tripSettings?.legTransport?.[currentKey] ?? transportLabel(tripSettings?.transport),
        pointToPointDuration:
          transit?.durationMinutes != null ? `${transit.durationMinutes} 分鐘` : "尚未設定",
      }}),
      weatherSummary: payload.weatherSummary ?? "",
      outfitSuggestion: payload.outfitSuggestion ?? "",
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? row.created_at,
      isOwner,
    };
  }
  return {
    id: row.id,
    title: row.title,
    customTitle: row.custom_title,
    isTitleCustomized: Boolean(row.is_title_customized),
    coverImageUrl: row.cover_image_url,
    customCoverImageUrl: row.custom_cover_image_url,
    aiGeneratedCoverImageUrl: row.cover_image,
    isCoverCustomized: Boolean(row.is_cover_customized),
    destinationPlace: null,
    originPlace: null,
    startDate: "",
    endDate: "",
    days: 1,
    transportMode: "",
    places: [],
    weatherSummary: "",
    outfitSuggestion: "",
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    isOwner,
  };
}

export function attachCoreTripToPayload(payload: RoamiePayloadV2, coreTrip: CoreTrip): RoamiePayloadV2 {
  return {
    ...payload,
    weatherSummary: coreTrip.weatherSummary,
    outfitSuggestion: coreTrip.outfitSuggestion,
    destinationLocation: payload.destinationLocation,
    originLocation: payload.originLocation,
    days: coreTrip.days,
    tripSettings: {
      ...payload.tripSettings,
      tripStartDate: coreTrip.startDate || payload.tripSettings?.tripStartDate,
      tripEndDate: coreTrip.endDate || payload.tripSettings?.tripEndDate,
      transport: (payload.tripSettings?.transport ?? "walk"),
    },
    // keep a single canonical model in payload
    coreTrip: {
      id: coreTrip.id,
      destinationPlace: coreTrip.destinationPlace,
      originPlace: coreTrip.originPlace,
      startDate: coreTrip.startDate,
      endDate: coreTrip.endDate,
      days: coreTrip.days,
      transportMode: coreTrip.transportMode,
      places: coreTrip.places,
      weatherSummary: coreTrip.weatherSummary,
      outfitSuggestion: coreTrip.outfitSuggestion,
      aiGeneratedCoverImageUrl: coreTrip.aiGeneratedCoverImageUrl,
    } as unknown as Record<string, unknown>,
  };
}

export async function getCoreTripById(tripId: string): Promise<CoreTrip | null> {
  const row = await getItinerary(tripId);
  if (!row) return null;
  return toCoreTrip(row);
}

export async function getLatestCoreTrip(): Promise<CoreTrip | null> {
  const rows = await listItineraries();
  const row = rows[0];
  if (!row) return null;
  return toCoreTrip(row);
}

export async function listCoreTrips(): Promise<CoreTrip[]> {
  const [rows, ownerMap] = await Promise.all([listItineraries(), listOwnedTripIds()]);
  return rows.map((row) =>
    toCoreTrip(row, { isOwner: ownerMap.has(row.id) ? Boolean(ownerMap.get(row.id)) : true }),
  );
}
