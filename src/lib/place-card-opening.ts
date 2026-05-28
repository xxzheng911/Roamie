import type { PlaceOpenStatus } from "@/lib/place-result";

export type PlaceCardOpeningSource =
  | "google_open_now"
  | "google_closed"
  | "google_closing_soon"
  | "unknown"
  | "mock";

export type PlaceCardOpeningDisplay = {
  statusLabel: string;
  hoursLabel: string;
  openNow: boolean | null;
  source: PlaceCardOpeningSource;
};

function stripTodayPrefix(label: string): string {
  return label.replace(/^今日\s*/, "").trim();
}

/** 探索／地圖推薦卡片：僅在 openNow 明確時顯示營業中／休息中 */
export function resolvePlaceCardOpeningDisplay(place: {
  id?: string;
  name?: string;
  openStatus: PlaceOpenStatus;
  todayHoursLabel?: string;
  closingSoonNote?: string;
  nextOpenHint?: string;
}): PlaceCardOpeningDisplay {
  const hoursRaw = place.todayHoursLabel?.trim() ?? "";
  const hoursOnly = hoursRaw && !hoursRaw.includes("待確認") ? stripTodayPrefix(hoursRaw) : "";

  if (place.openStatus === "open") {
    return {
      statusLabel: "營業中",
      hoursLabel: hoursOnly,
      openNow: true,
      source: "google_open_now",
    };
  }

  if (place.openStatus === "closing_soon") {
    return {
      statusLabel: "即將打烊",
      hoursLabel: hoursOnly,
      openNow: true,
      source: "google_closing_soon",
    };
  }

  if (place.openStatus === "closed_now") {
    return {
      statusLabel: "休息中",
      hoursLabel: hoursOnly,
      openNow: false,
      source: "google_closed",
    };
  }

  if (place.id?.startsWith("mock-")) {
    return {
      statusLabel: "",
      hoursLabel: "暫時無法確認營業時間",
      openNow: null,
      source: "mock",
    };
  }

  return {
    statusLabel: "",
    hoursLabel: "暫時無法確認營業時間",
    openNow: null,
    source: "unknown",
  };
}

export function logPlaceCardOpening(placeName: string, display: PlaceCardOpeningDisplay): void {
  console.info(
    "[PLACE_OPENING] placeName=",
    placeName,
    "openNow=",
    display.openNow,
    "source=",
    display.source,
  );
}
