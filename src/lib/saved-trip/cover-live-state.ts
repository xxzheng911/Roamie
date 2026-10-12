import type { StoredItinerary } from "@/lib/itinerary-storage";
import type { TransitLegAdvice } from "@/lib/transit/types";

export const SAVED_TRIPS_CHANGED_EVENT = "roamie:saved-trips-changed";
export type CoverFields = Pick<
  StoredItinerary,
  | "cover_image"
  | "custom_cover_image_url"
  | "cover_image_url"
  | "is_cover_customized"
  | "cover_source"
  | "cover_query"
>;
export type TripCoverUpdate = {
  kind: "cover";
  tripId: string;
  fields: CoverFields;
  updatedAt: string;
  resolution: "pending" | "resolved" | "fallback";
};

// Session-only replay: no row payload, identity, persistence, provider or DB calls.
const covers = new Map<string, TripCoverUpdate>();
export const getTripCoverUpdate = (id: string) => covers.get(id);

// PostgreSQL revisions may differ within one millisecond. Preserve microseconds.
export function coverRevision(value: string): number {
  const epoch = Date.parse(value);
  const fraction = value.match(/\.(\d+)/)?.[1] ?? "";
  return Number.isFinite(epoch) ? epoch * 1000 + Number(fraction.padEnd(6, "0").slice(3, 6)) : 0;
}

function fieldsFromRow(row: CoverFields): CoverFields {
  return {
    cover_image: row.cover_image,
    custom_cover_image_url: row.custom_cover_image_url,
    cover_image_url: row.cover_image_url,
    is_cover_customized: row.is_cover_customized,
    cover_source: row.cover_source,
    cover_query: row.cover_query,
  };
}

export function publishTripCover(
  row: CoverFields & { id: string; updated_at: string },
  resolution: TripCoverUpdate["resolution"] = row.cover_source === "roamie"
    ? "fallback"
    : "resolved",
): void {
  const previous = covers.get(row.id);
  if (previous && coverRevision(row.updated_at) < coverRevision(previous.updatedAt)) return;
  if (previous && previous.resolution !== "pending" && resolution === "pending") return;
  const update: TripCoverUpdate = {
    kind: "cover",
    tripId: row.id,
    fields: fieldsFromRow(row),
    updatedAt: row.updated_at,
    resolution,
  };
  covers.set(row.id, update);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SAVED_TRIPS_CHANGED_EVENT, { detail: update }));
  }
}

export function isTripCoverEvent(event: Event): boolean {
  return (event as CustomEvent<TripCoverUpdate>).detail?.kind === "cover";
}

export function readTripCoverEvent(event: Event): TripCoverUpdate | null {
  const detail = (event as CustomEvent<TripCoverUpdate>).detail;
  // Only accept the current snapshot, never a delayed/outdated event payload.
  return detail?.kind === "cover" && covers.get(detail.tripId) === detail ? detail : null;
}

/** Narrow patch only: never change row revision, payload, title or itinerary edits. */
export function applyTripCover<T extends CoverFields & { id: string; updated_at: string }>(
  row: T,
): T {
  const update = covers.get(row.id);
  if (!update || coverRevision(row.updated_at) > coverRevision(update.updatedAt)) return row;
  return { ...row, ...update.fields };
}

/**
 * Cover row the open editor should show after a live update (null = no live update).
 * applyTripCover keeps the version guard: an older live patch never overrides a newer
 * row, and a newer row (e.g. this client's own save echo) contributes its own persisted
 * cover columns instead of being dropped.
 */
export function coverStateForLiveUpdate<T extends CoverFields & { id: string; updated_at: string }>(
  row: T,
  live: TripCoverUpdate | null | undefined = covers.get(row.id),
): T | null {
  return live ? applyTripCover(row) : null;
}

// Background Routes enrichment for an open trip, same session-only replay lifecycle as
// covers. Its own event channel: saved/home lists must not reload for it.
export const TRIP_ROUTE_ENRICHMENT_EVENT = "roamie:trip-route-enrichment";
const routeEnrichments = new Map<string, Record<string, TransitLegAdvice>>();

function trustedEnrichedLeg(key: string, leg: TransitLegAdvice | undefined): boolean {
  if (!leg || key.includes("§")) return false; // day-scoped keys belong to Directions sync
  const mode = leg.resolvedMode ?? leg.transportMode;
  const slot = mode === "WALK" ? "walk" : mode === "DRIVE" ? "drive" : mode === "TRANSIT" ? "transit" : null;
  const minutes = slot ? leg.estimates?.[slot] : leg.durationMinutes;
  return Boolean(
    leg.savedRouteEndpoints &&
    leg.routeStatus === "ok" &&
    leg.durationSource === "directions" &&
    typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0,
  );
}

/** Publish verified save-time legs for one trip; unverified legs are dropped. */
export function publishTripRouteEnrichment(
  tripId: string,
  legs: Record<string, TransitLegAdvice>,
): void {
  const trusted = Object.fromEntries(
    Object.entries(legs).filter(([key, leg]) => trustedEnrichedLeg(key, leg)),
  );
  if (!Object.keys(trusted).length) return;
  routeEnrichments.set(tripId, { ...(routeEnrichments.get(tripId) ?? {}), ...trusted });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(TRIP_ROUTE_ENRICHMENT_EVENT, { detail: { tripId } }));
  }
}

export const getTripRouteEnrichment = (tripId: string) => routeEnrichments.get(tripId);

/**
 * Add-only merge into the editor's transitLegs: never overwrites an existing key (day-scoped
 * sync results keep their status and routeRetryAfter; user/edited legs win). Returns the same
 * reference when nothing changes, so duplicate events cannot trigger another autosave.
 */
export function mergeTripRouteEnrichment(
  current: Record<string, TransitLegAdvice> | undefined,
  enrichment: Record<string, TransitLegAdvice> | undefined,
): Record<string, TransitLegAdvice> | undefined {
  if (!enrichment) return current;
  const additions = Object.entries(enrichment).filter(([key]) => !current?.[key]);
  if (!additions.length) return current;
  return { ...(current ?? {}), ...Object.fromEntries(additions) };
}
