import type { RoamieItineraryItem, RoamiePayloadV2, TripPlanSettings } from "@/lib/ai/types";
import type { OutfitAdvicePayload } from "@/lib/outfit/types";
import { tripPayloadFingerprint } from "@/lib/trip/trip-payload-persist";

/** 暫停自動儲存以隔離 render loop（驗證後改回 false） */
export const TRIP_EDITOR_AUTO_SAVE_DISABLED = true;

export function hashItineraryItems(items: RoamieItineraryItem[]): string {
  return tripPayloadFingerprint(
    { version: 2, title: "", summary: "", moodTag: "", recommendations: [], itinerary: items },
    null,
  );
}

export function hashTripSettings(settings: TripPlanSettings): string {
  return tripPayloadFingerprint(
    {
      version: 2,
      title: "",
      summary: "",
      moodTag: "",
      recommendations: [],
      itinerary: [],
      tripSettings: settings,
    },
    null,
  );
}

export function hashOutfitSlice(
  outfitAdvice: OutfitAdvicePayload | undefined,
  outfitAdviceInputKey: string | undefined,
  outfitExtras: Record<string, unknown> | null,
): string {
  return tripPayloadFingerprint(
    {
      version: 2,
      title: "",
      summary: "",
      moodTag: "",
      recommendations: [],
      itinerary: [],
      outfitAdvice,
      outfitAdviceInputKey,
      ...(outfitExtras ?? {}),
    } as RoamiePayloadV2,
    null,
  );
}

/** 與舊版 editor 相容：整包 payload 指紋 */
export function computeEditorPayloadFingerprint(payload: RoamiePayloadV2): string {
  return tripPayloadFingerprint(payload, payload.moodTag ?? null);
}

export function buildEditorPayloadFingerprint(parts: {
  tripTitle: string;
  items: RoamieItineraryItem[];
  settings: TripPlanSettings;
  outfitAdvice?: OutfitAdvicePayload;
  outfitAdviceInputKey?: string;
  outfitExtras: Record<string, unknown> | null;
  moodTag?: string | null;
}): string {
  return tripPayloadFingerprint(
    {
      ...({
        version: 2,
        title: parts.tripTitle,
        summary: "",
        moodTag: parts.moodTag ?? "",
        recommendations: [],
        itinerary: parts.items,
        tripSettings: parts.settings,
        outfitAdvice: parts.outfitAdvice,
        outfitAdviceInputKey: parts.outfitAdviceInputKey,
      } as RoamiePayloadV2),
      ...(parts.outfitExtras ?? {}),
    },
    parts.moodTag ?? null,
  );
}

export function buildStableEditorPayload(
  base: RoamiePayloadV2,
  parts: {
    tripTitle: string;
    items: RoamieItineraryItem[];
    settings: TripPlanSettings;
    outfitAdvice?: OutfitAdvicePayload;
    outfitAdviceInputKey?: string;
    outfitExtras: Record<string, unknown> | null;
  },
): RoamiePayloadV2 {
  const next: RoamiePayloadV2 = {
    ...base,
    title: parts.tripTitle,
    itinerary: parts.items,
    tripSettings: parts.settings,
    recommendations: [],
    outfitAdvice: parts.outfitAdvice,
    outfitAdviceInputKey: parts.outfitAdviceInputKey,
  };
  if (parts.outfitExtras) {
    Object.assign(next, parts.outfitExtras);
  }
  return next;
}
