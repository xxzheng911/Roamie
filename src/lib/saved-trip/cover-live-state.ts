import type { StoredItinerary } from "@/lib/itinerary-storage";

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
