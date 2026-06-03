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

/** 卡片右側時段：不含營業狀態字（營業中／已打烊由 statusLabel 單獨顯示） */
export function formatPlaceCardHoursLabel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes("待確認")) return "";

  const withoutPrefix = trimmed
    .replace(/^今日營業時間\s*/i, "")
    .replace(/^今日\s*/, "")
    .trim();

  if (!withoutPrefix) return "";

  if (/24\s*小時|24小時|24\s*h|open\s*24/i.test(withoutPrefix)) {
    return "24 小時營業";
  }

  if (/^\d{1,2}:\d{2}/.test(withoutPrefix)) {
    return `今日 ${withoutPrefix}`;
  }

  if (trimmed.startsWith("今日")) return trimmed;

  return withoutPrefix;
}

function inferOpenStatusFromLabel(label: string): PlaceOpenStatus | null {
  const t = label.trim();
  if (!t) return null;
  if (/營業中|open now|営業中|영업 중/i.test(t)) return "open";
  if (/即將打烊|closing soon/i.test(t)) return "closing_soon";
  if (/已打烊|目前休息|目前未營業|休息|closed|閉店|定休/i.test(t)) return "closed_now";
  if (/暫時歇業|temporarily closed/i.test(t)) return "temporarily_closed";
  return null;
}

function resolveEffectiveOpenStatus(
  openStatus: PlaceOpenStatus,
  openStatusLabel?: string,
): PlaceOpenStatus {
  if (openStatus !== "unknown") return openStatus;
  return inferOpenStatusFromLabel(openStatusLabel ?? "") ?? "unknown";
}

/** 探索／首頁附近卡片：營業狀態與今日時段 */
export function resolvePlaceCardOpeningDisplay(place: {
  id?: string;
  name?: string;
  openStatus: PlaceOpenStatus;
  openStatusLabel?: string;
  todayHoursLabel?: string;
  closesAtLabel?: string;
  closingSoonNote?: string;
  nextOpenHint?: string;
  businessStatus?: string | null;
}): PlaceCardOpeningDisplay {
  const effectiveStatus = resolveEffectiveOpenStatus(place.openStatus, place.openStatusLabel);
  const hoursDisplay = formatPlaceCardHoursLabel(place.todayHoursLabel ?? "");
  const closesAt = place.closesAtLabel?.trim() ?? "";
  const hoursDetail = hoursDisplay || (closesAt && !/營業中|打烊|歇業/i.test(closesAt) ? closesAt : "");

  if (effectiveStatus === "open") {
    return {
      statusLabel: "營業中",
      hoursLabel: hoursDetail,
      openNow: true,
      source: "google_open_now",
    };
  }

  if (effectiveStatus === "closing_soon") {
    return {
      statusLabel: "即將打烊",
      hoursLabel: hoursDetail || closesAt,
      openNow: true,
      source: "google_closing_soon",
    };
  }

  if (effectiveStatus === "closed_now") {
    const hint = place.nextOpenHint?.trim();
    const closedHours = hoursDisplay || (hint && !/營業中|打烊/i.test(hint) ? hint : "");
    return {
      statusLabel: "已打烊",
      hoursLabel: closedHours,
      openNow: false,
      source: "google_closed",
    };
  }

  if (effectiveStatus === "temporarily_closed") {
    return {
      statusLabel: "暫時歇業",
      hoursLabel: hoursDisplay,
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

  const labelStatus = inferOpenStatusFromLabel(place.openStatusLabel ?? "");
  if (labelStatus === "open") {
    return {
      statusLabel: "營業中",
      hoursLabel: hoursDetail,
      openNow: true,
      source: "google_open_now",
    };
  }

  if (hoursDisplay) {
    return {
      statusLabel: "",
      hoursLabel: hoursDisplay,
      openNow: null,
      source: "unknown",
    };
  }

  if (place.openStatusLabel?.trim()) {
    const label = place.openStatusLabel.trim();
    const inferred = inferOpenStatusFromLabel(label);
    if (inferred === "open" || inferred === "closing_soon" || inferred === "closed_now" || inferred === "temporarily_closed") {
      return resolvePlaceCardOpeningDisplay({
        ...place,
        openStatus: inferred,
        openStatusLabel: "",
      });
    }
    return {
      statusLabel: label,
      hoursLabel: hoursDisplay,
      openNow: null,
      source: "unknown",
    };
  }

  if ((place.businessStatus ?? "").toUpperCase() === "OPERATIONAL") {
    return {
      statusLabel: "",
      hoursLabel: "營業時間待確認",
      openNow: null,
      source: "unknown",
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
