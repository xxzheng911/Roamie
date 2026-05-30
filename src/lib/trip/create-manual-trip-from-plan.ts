import type { RoamieItineraryItem, RoamiePayloadV2, TripTransportMode } from "@/lib/ai/types";
import type { ClientContextBundle } from "@/lib/fetch-context";
import { confirmSaveTrip, type StoredItinerary } from "@/lib/itinerary-storage";
import { formatTripLocationLabel } from "@/lib/location/format";
import type { PlanTripFormInput } from "@/lib/plan-trip-handoff";
import { listTripDates } from "@/lib/outfit/group-by-date";
import { generateTripDailyOutfitAdvice } from "@/lib/outfit/outfit-daily.functions";
import { buildOutfitInputKey, buildTripItemsFingerprint } from "@/lib/outfit/trip-outfit-context";
import {
  tripPlaceFromRecommendation,
  tripPlaceToItineraryItem,
} from "@/lib/trip/trip-place-input";
import { generateTripTitle } from "@/lib/trip/trip-title";

function inferPlanFormTransport(transport: string): TripTransportMode {
  const t = transport.trim().toLowerCase();
  if (!t) return "walk";
  if (/機車|scooter|摩托|バイク|오토바이/.test(t)) return "scooter";
  if (/開車|自驾|自駕|drive|car|租車|レンタカー|렌터카|self-drive/.test(t)) return "drive";
  if (
    /捷運|地鐵|地铁|大眾|公車|公交|transit|mrt|metro|公共交通|대중교통|public transit/.test(t)
  ) {
    return "transit";
  }
  if (/計程車|taxi|uber|配車|택시|rideshare|共乘/.test(t)) return "transit";
  if (/單車|自行车|自転車|자전거|cycling|bike/.test(t)) return "walk";
  return "walk";
}

function buildTripSummary(form: PlanTripFormInput, destLabel: string): string {
  const parts = [
    `在 ${destLabel} 的 ${form.days} 天行程，地點與時間由你自行安排。`,
    form.interests.trim(),
    form.styles.length ? `風格：${form.styles.join("、")}` : "",
    form.mood ? `心情：${form.mood}` : "",
  ].filter(Boolean);
  return parts.join("\n").slice(0, 500);
}

function buildItineraryFromSelectedPlaces(form: PlanTripFormInput): RoamieItineraryItem[] {
  const places = form.selectedPlaces ?? [];
  if (places.length === 0) return [];

  const startDate = form.startDate || new Date().toISOString().slice(0, 10);
  const dateKeys = listTripDates([], startDate, form.days);
  const itinerary: RoamieItineraryItem[] = [];

  places.forEach((rec, index) => {
    const tripPlace = tripPlaceFromRecommendation(rec);
    const date = dateKeys[index % dateKeys.length] ?? startDate;
    const hour = 10 + (index % 6);
    itinerary.push(
      tripPlaceToItineraryItem(tripPlace, {
        date,
        time: `${String(hour).padStart(2, "0")}:00`,
      }),
    );
  });

  return itinerary;
}

/** 由「規劃新行程」表單建立可手動編輯的收藏行程 payload（不經 AI / chat） */
export function buildManualTripPayloadFromPlan(
  form: PlanTripFormInput,
  bundle: ClientContextBundle,
): RoamiePayloadV2 {
  const destLabel = formatTripLocationLabel(form.destination);
  const startDate = form.startDate || new Date().toISOString().slice(0, 10);
  const endDate = form.endDate || startDate;
  const transport = inferPlanFormTransport(form.transport);
  const itinerary = buildItineraryFromSelectedPlaces(form);
  const w = bundle.weather;

  return {
    version: 2,
    title: generateTripTitle({
      destination: destLabel,
      mood: form.mood,
      moodTag: form.mood,
    }),
    summary: buildTripSummary(form, destLabel),
    moodTag: form.mood || "",
    recommendations: [],
    itinerary,
    destination: destLabel,
    destinationLocation: form.destination,
    originLocation: form.origin ?? undefined,
    days: form.days,
    generatedAt: new Date().toISOString(),
    tripSettings: {
      startTime: "10:00",
      transport,
      tripStartDate: startDate,
      tripEndDate: endDate,
      legMinutes: {},
      legTransport: {},
      transitLegs: {},
    },
    weatherSummary: w
      ? `${w.city ?? destLabel}：${w.condition}，約 ${w.tempC}°C${w.precipProbability != null ? `，降雨機率 ${w.precipProbability}%` : ""}`
      : undefined,
    travelers: form.travelers,
  } as RoamiePayloadV2;
}

export async function createTripFromPlanForm(
  form: PlanTripFormInput,
  bundle: ClientContextBundle,
): Promise<StoredItinerary> {
  const payload = buildManualTripPayloadFromPlan(form, bundle);
  const destLabel = formatTripLocationLabel(form.destination);
  const startDate = form.startDate || new Date().toISOString().slice(0, 10);
  const endDate = form.endDate || startDate;

  try {
    const outfitAdvice = await generateTripDailyOutfitAdvice({
      data: {
        destination: destLabel,
        destinationLocation: form.destination,
        startDate,
        endDate,
        dayCount: form.days,
        items: payload.itinerary,
        mood: form.mood,
      },
    });
    payload.outfitAdvice = outfitAdvice;
    payload.outfitAdviceInputKey = buildOutfitInputKey({
      destination: destLabel,
      startDate,
      endDate,
      dayCount: form.days,
      itemsFingerprint: buildTripItemsFingerprint(payload.itinerary),
    });
  } catch (e) {
    console.warn("[PLAN_TRIP] outfit advice skipped", e);
  }

  return confirmSaveTrip(payload, "plan");
}
