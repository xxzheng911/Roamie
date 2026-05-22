import type { RoamieRequestContext } from "@/lib/ai/context";
import type { RoamieItineraryItem, RoamieRecommendationItem, RoamieResponse } from "@/lib/ai/types";
import { normalizeRecommendationItem } from "@/lib/ai/types";
import {
  applyAvailabilityFields,
  derivePlaceAvailability,
  filterAvailablePlaces,
  type FilterPlacesContext,
  type PlaceHoursData,
} from "@/lib/filter-available-places";
import { lookupPlacesHoursBatch } from "@/lib/places.functions";

export type EnrichRoamieOptions = {
  context: FilterPlacesContext;
  lat?: number;
  lng?: number;
  /** 行程起始日 YYYY-MM-DD */
  tripStartDate?: string;
};

function resolveCenter(ctx: RoamieRequestContext): { lat: number; lng: number } | null {
  const lat = ctx.location?.lat;
  const lng = ctx.location?.lng;
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

function enrichOptsFromContext(ctx: RoamieRequestContext): EnrichRoamieOptions | null {
  const center = resolveCenter(ctx);
  if (!center) return null;

  if (ctx.mode === "itinerary") {
    return {
      context: "scheduled",
      lat: center.lat,
      lng: center.lng,
      tripStartDate:
        ctx.itineraryRequest?.startDate?.trim() ||
        new Date().toISOString().slice(0, 10),
    };
  }

  return { context: "now", lat: center.lat, lng: center.lng };
}

function parseItineraryAt(tripStartDate: string | undefined, item: RoamieItineraryItem): Date {
  const dateStr = item.date?.trim() || tripStartDate || new Date().toISOString().slice(0, 10);
  const base = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(base.getTime())) return new Date();
  return base;
}

async function enrichRecommendations(
  recs: RoamieRecommendationItem[],
  opts: EnrichRoamieOptions,
): Promise<RoamieRecommendationItem[]> {
  const center = { lat: opts.lat!, lng: opts.lng! };
  const hoursMap = await lookupPlacesHoursBatch(
    recs.map((r) => ({
      name: r.name,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
    })),
    center,
  );

  const withHours = recs.map((rec) => {
    const hours: PlaceHoursData = hoursMap.get(rec.name) ?? {};
    const availability = derivePlaceAvailability(hours, { context: opts.context });
    return {
      rec: normalizeRecommendationItem(rec),
      hours,
      availability,
    };
  });

  const filtered = filterAvailablePlaces(
    withHours,
    (x) => x.hours,
    { context: opts.context },
  );

  return filtered.map(({ rec, availability }) =>
    applyAvailabilityFields(rec, availability),
  );
}

async function enrichItinerary(
  items: RoamieItineraryItem[],
  opts: EnrichRoamieOptions,
): Promise<RoamieItineraryItem[]> {
  const center = { lat: opts.lat!, lng: opts.lng! };
  const names = [...new Set(items.map((i) => i.placeName).filter(Boolean))];
  if (!names.length) return items;

  const hoursMap = await lookupPlacesHoursBatch(
    names.map((name) => {
      const item = items.find((i) => i.placeName === name);
      return { name, lat: item?.lat, lng: item?.lng };
    }),
    center,
  );

  const kept: RoamieItineraryItem[] = [];

  for (const item of items) {
    const hours: PlaceHoursData = hoursMap.get(item.placeName) ?? {};
    const at = parseItineraryAt(opts.tripStartDate, item);
    const availability = derivePlaceAvailability(hours, {
      context: "scheduled",
      at,
      atTime: item.time,
    });

    if (!availability.isRecommendable) continue;
    if (availability.openStatus === "closed_now") continue;

    kept.push(item);
  }

  return kept;
}

/** AI 回應後補齊營業時間並套用全域推薦規則 */
export async function enrichRoamieResponse(
  response: RoamieResponse,
  ctx: RoamieRequestContext,
): Promise<RoamieResponse> {
  const opts = enrichOptsFromContext(ctx);
  if (!opts?.lat || !opts.lng) return response;

  const [recommendations, itinerary] = await Promise.all([
    response.recommendations?.length
      ? enrichRecommendations(response.recommendations, opts)
      : Promise.resolve(response.recommendations ?? []),
    response.itinerary?.length && opts.context === "scheduled"
      ? enrichItinerary(response.itinerary, opts)
      : Promise.resolve(response.itinerary ?? []),
  ]);

  return {
    ...response,
    recommendations,
    itinerary,
  };
}
