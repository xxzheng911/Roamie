import {
  isRoamiePayloadV2,
  type RoamieItineraryItem,
  type RoamiePayloadV2,
} from "@/lib/ai/types";
import { confirmSaveTrip, getItinerary, updateItinerary } from "@/lib/itinerary-storage";
import { loadDraftTrip, saveDraftTrip } from "@/lib/trip-draft-storage";
import { insertStopOnDate } from "@/lib/trip/trip-stop-mutations";
import { tripPlaceToItineraryItem, type TripPlaceInput } from "@/lib/trip/trip-place-input";
import { tagUserSavedTrip } from "@/lib/saved-collection";

export type AppendPlaceTarget =
  | { kind: "draft" }
  | { kind: "trip"; tripId: string }
  | { kind: "new"; title: string; destination?: string };

export type AppendPlaceOptions = {
  date: string;
  time?: string;
  position: "start" | "end";
  afterPlaceName?: string;
  notes?: string;
};

export async function appendPlaceToTrip(
  target: AppendPlaceTarget,
  place: TripPlaceInput,
  options: AppendPlaceOptions,
): Promise<{ tripId: string; isDraft: boolean }> {
  const stop = tripPlaceToItineraryItem(place, {
    date: options.date,
    time: options.time,
    notes: options.notes,
  });

  if (target.kind === "new") {
    const payload: RoamiePayloadV2 = tagUserSavedTrip(
      {
        version: 2,
        title: target.title,
        summary: `Roamie 陪你慢慢整理「${place.placeName}」開始的旅程。`,
        moodTag: "",
        recommendations: [],
        itinerary: [stop],
        destination: target.destination ?? place.address,
        days: 1,
        generatedAt: new Date().toISOString(),
        tripSettings: { startTime: options.time ?? "10:00", transport: "walk", legMinutes: {} },
        userSaved: true,
        source: "plan",
      },
      "plan",
    );
    const saved = await confirmSaveTrip(payload, "plan");
    return { tripId: saved.id, isDraft: false };
  }

  if (target.kind === "draft") {
    const draft = loadDraftTrip();
    const base: RoamiePayloadV2 = draft ?? {
      version: 2,
      title: "行程草稿",
      summary: "",
      moodTag: "",
      recommendations: [],
      itinerary: [],
      generatedAt: new Date().toISOString(),
      tripSettings: { startTime: "10:00", transport: "walk", legMinutes: {} },
    };
    const itinerary = insertStopOnDate(base.itinerary ?? [], stop, {
      date: options.date,
      position: options.position,
      afterPlaceName: options.afterPlaceName,
    });
    saveDraftTrip({ ...base, itinerary, recommendations: [] });
    return { tripId: "draft", isDraft: true };
  }

  const stored = await getItinerary(target.tripId);
  if (!stored) throw new Error("找不到這趟行程");

  let payload = stored.payload;
  if (!isRoamiePayloadV2(payload)) {
    throw new Error("此行程格式較舊，請先從聊天重新產生行程");
  }

  const itinerary = insertStopOnDate(payload.itinerary ?? [], stop, {
    date: options.date,
    position: options.position,
    afterPlaceName: options.afterPlaceName,
  });

  await updateItinerary(target.tripId, { ...payload, itinerary, recommendations: [] });
  return { tripId: target.tripId, isDraft: false };
}

export function getPayloadItinerary(payload: unknown): RoamieItineraryItem[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as { itinerary?: RoamieItineraryItem[] };
  return Array.isArray(p.itinerary) ? p.itinerary : [];
}
