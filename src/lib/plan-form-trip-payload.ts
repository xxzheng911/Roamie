import type {
  RoamieItineraryItem,
  RoamiePayloadV2,
  RoamieRecommendationItem,
  TripTransportMode,
} from "@/lib/ai/types";
import { formatTripLocationLabel } from "@/lib/location/format";
import { tagUserSavedTrip } from "@/lib/saved-collection";
import type { PlanTripFormInput } from "@/lib/plan-trip-handoff";

function inferTripTransport(transport?: string): TripTransportMode {
  const t = (transport ?? "").toLowerCase();
  if (/機車|scooter|摩托/.test(t)) return "scooter";
  if (/開車|自驾|自駕|drive|car|租車/.test(t)) return "drive";
  if (/捷運|地鐵|地铁|大眾|公車|公交|transit|mrt|metro/.test(t)) return "transit";
  return "walk";
}

function recommendationsToItinerary(
  places: RoamieRecommendationItem[],
  startDate: string,
): RoamieItineraryItem[] {
  return places.map((place, index) => ({
    date: startDate,
    time: `${String(10 + index).padStart(2, "0")}:00`,
    title: place.name,
    description: place.description?.trim() || place.type || "",
    placeName: place.name,
    lat: place.lat ?? null,
    lng: place.lng ?? null,
    address: place.address,
    googlePlaceId: place.googlePlaceId,
    placeType: place.type,
  }));
}

export type BuildPlanFormTripPayloadInput = PlanTripFormInput & {
  budgetLabel?: string;
};

export function buildPlanFormTripPayload(form: BuildPlanFormTripPayloadInput): RoamiePayloadV2 {
  const destLabel = formatTripLocationLabel(form.destination);
  const originLabel = form.origin ? formatTripLocationLabel(form.origin) : "";
  const styleLine = form.styles.join("、");
  const budgetLine = form.budgetLabel?.trim() || form.budgetMode;
  const summaryParts = [
    originLabel ? `出發：${originLabel}` : "",
    `${form.travelers} 人同行`,
    form.transport ? `交通：${form.transport}` : "",
    styleLine ? `風格：${styleLine}` : "",
    budgetLine ? `預算：${budgetLine}` : "",
  ].filter(Boolean);

  const selectedPlaces = form.selectedPlaces ?? [];
  const itinerary =
    selectedPlaces.length > 0
      ? recommendationsToItinerary(selectedPlaces, form.startDate)
      : [];

  return tagUserSavedTrip(
    {
      version: 2,
      title: destLabel,
      summary: summaryParts.join(" · ") || `前往 ${destLabel} 的行程`,
      moodTag: form.mood || "慢旅行",
      destination: destLabel,
      destinationLocation: form.destination,
      originLocation: form.origin ?? undefined,
      days: form.days,
      travelers: form.travelers,
      recommendations: selectedPlaces,
      itinerary,
      tripSettings: {
        startTime: form.departureTime || "10:00",
        tripStartDate: form.startDate || undefined,
        tripEndDate: form.endDate || form.startDate || undefined,
        transport: inferTripTransport(form.transport),
        legMinutes: {},
      },
      generatedAt: new Date().toISOString(),
    },
    "plan",
  );
}
