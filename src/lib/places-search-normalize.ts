import type { PlaceResult } from "@/lib/place-result";

export type PlacesSearchResult = { places: PlaceResult[]; error: string | null };

/** 確保 server/client 回傳永遠有 places[]，避免 .places.length throw */
export function normalizePlacesSearchResult(raw: unknown): PlacesSearchResult {
  if (raw && typeof raw === "object") {
    const r = raw as Partial<PlacesSearchResult>;
    const places = Array.isArray(r.places) ? r.places : [];
    const error =
      typeof r.error === "string"
        ? r.error
        : r.error != null
          ? String(r.error)
          : places.length === 0 && !Array.isArray(r.places)
            ? "places_undefined"
            : null;
    return { places, error };
  }
  return { places: [], error: "invalid_places_response" };
}
