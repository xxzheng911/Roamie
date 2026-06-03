import type { PlaceResult } from "@/lib/place-result";
import {
  resolvePlaceCardOpeningDisplay,
  type PlaceCardOpeningDisplay,
} from "@/lib/place-card-opening";

export type PlaceDetailHoursSource = "google_places_details" | "none";

export type PlaceDetailHoursView = PlaceCardOpeningDisplay & {
  hoursSource: PlaceDetailHoursSource;
};

export function logPlaceDetailHoursSource(meta: {
  placeName: string;
  placeId: string;
  source: PlaceDetailHoursSource | "none";
  openNow: boolean | null;
  todayHoursLabel: string;
}): void {
  console.info("[PLACE_DETAIL_HOURS_SOURCE]", meta);
}

function hasGoogleHoursFields(place: PlaceResult): boolean {
  return Boolean(
    place.openStatus !== "unknown" ||
      place.openStatusLabel?.trim() ||
      place.todayHoursLabel?.trim() ||
      place.closingSoonNote?.trim() ||
      place.nextOpenHint?.trim() ||
      (place.businessStatus ?? "").trim(),
  );
}

/** 地點詳情頁：僅在已有 Google Details 營業欄位時顯示狀態，否則顯示無法確認 */
export function resolvePlaceDetailHoursDisplay(
  place: Pick<
    PlaceResult,
    | "openStatus"
    | "openStatusLabel"
    | "todayHoursLabel"
    | "closingSoonNote"
    | "nextOpenHint"
    | "businessStatus"
  > & { id: string; name: string },
  options?: { fromGoogleDetails?: boolean },
): PlaceDetailHoursView {
  const fromGoogle = options?.fromGoogleDetails === true || hasGoogleHoursFields(place);

  if (!fromGoogle) {
    return {
      statusLabel: "",
      hoursLabel: "暫時無法確認營業時間",
      openNow: null,
      hoursSource: "none",
      source: "unknown",
    };
  }

  const display = resolvePlaceCardOpeningDisplay(place);
  const noUsableHours =
    !display.statusLabel &&
    (!display.hoursLabel ||
      display.hoursLabel === "營業資訊未知" ||
      display.hoursLabel === "營業時間待確認");

  if (noUsableHours) {
    return {
      ...display,
      statusLabel: "",
      hoursLabel: "暫時無法確認營業時間",
      hoursSource: "none",
    };
  }

  return { ...display, hoursSource: "google_places_details" };
}
