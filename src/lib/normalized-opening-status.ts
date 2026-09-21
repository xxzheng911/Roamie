import {
  derivePlaceAvailability,
  getTodayHoursFromDescriptions,
  type PlaceHoursData,
  type PlaceOpenStatus,
} from "@/lib/filter-available-places";
import type { PlaceResult } from "@/lib/place-result";
import type { Locale } from "@/lib/i18n/types";
import { translate } from "@/lib/i18n/translate";

export type NormalizedOpeningStatusValue = "open" | "closed" | "unknown";

export type NormalizedOpeningSource =
  | "currentOpeningHours"
  | "regularOpeningHours"
  | "businessStatus"
  | "cachedPlace"
  | "unknown";

/** 列表／詳情共用的營業狀態 view */
export type NormalizedOpeningView = {
  status: NormalizedOpeningStatusValue;
  label: "營業中" | "休息中" | "營業資訊暫缺";
  source: NormalizedOpeningSource;
  openNow: boolean | null;
};

/** @deprecated 使用 NormalizedOpeningView.status */
export type NormalizedOpeningStatus = NormalizedOpeningStatusValue | "open_now" | "no_hours" | "closed";

export type NormalizedOpeningInfo = NormalizedOpeningView & {
  normalizedOpeningStatus: NormalizedOpeningStatusValue;
  normalizedOpeningLabel: string;
};

const CLOSED_HOURS_TEXT_RE = /休息|閉店|closed|定休|暫停|不營業/i;

function isClosedHoursText(text: string): boolean {
  return CLOSED_HOURS_TEXT_RE.test(text.trim());
}

function resolveOpenNowWithSource(
  data: PlaceHoursData,
): { openNow: boolean | null; source: NormalizedOpeningSource } {
  const current = data.currentOpeningHours?.openNow;
  if (current === true || current === false) {
    return { openNow: current, source: "currentOpeningHours" };
  }

  const regular = data.regularOpeningHours?.openNow;
  if (regular === true || regular === false) {
    return { openNow: regular, source: "regularOpeningHours" };
  }

  const biz = (data.businessStatus ?? "").trim().toUpperCase();
  if (biz === "CLOSED_PERMANENTLY" || biz === "CLOSED_TEMPORARILY") {
    return { openNow: false, source: "businessStatus" };
  }
  if (biz === "OPERATIONAL") {
    return { openNow: null, source: "businessStatus" };
  }

  return { openNow: null, source: "unknown" };
}

/** 列表／詳情共用：以 Google openNow 為最高優先 */
export function normalizeOpeningStatus(data: PlaceHoursData): NormalizedOpeningInfo {
  const { openNow, source } = resolveOpenNowWithSource(data);

  if (openNow === true) {
    return {
      status: "open",
      label: "營業中",
      source,
      openNow: true,
      normalizedOpeningStatus: "open",
      normalizedOpeningLabel: "營業中",
    };
  }

  if (openNow === false) {
    return {
      status: "closed",
      label: "休息中",
      source,
      openNow: false,
      normalizedOpeningStatus: "closed",
      normalizedOpeningLabel: "休息中",
    };
  }

  return {
    status: "unknown",
    label: "營業資訊暫缺",
    source,
    openNow: null,
    normalizedOpeningStatus: "unknown",
    normalizedOpeningLabel: "營業資訊暫缺",
  };
}

export function normalizedOpeningStatusToPlaceOpenStatus(
  status: NormalizedOpeningStatusValue,
): PlaceOpenStatus {
  switch (status) {
    case "open":
      return "open";
    case "closed":
      return "closed_now";
    default:
      return "unknown";
  }
}

/** 今日時段文字（不含與 openNow 衝突的「休息」） */
export function buildTodayHoursLine(
  data: PlaceHoursData,
  view: NormalizedOpeningView,
  at = new Date(),
): string {
  const raw = getTodayHoursFromDescriptions(data, at).trim();

  if (view.openNow === true) {
    if (raw && !isClosedHoursText(raw)) return `今日 ${raw}`;
    return "今日營業中";
  }

  if (view.openNow === false) {
    if (raw && !isClosedHoursText(raw)) return `今日 ${raw}`;
    return view.label;
  }

  if (raw && !isClosedHoursText(raw)) return `今日 ${raw}`;
  return "";
}

export type OpeningDisplayState = "open" | "closed" | "closingSoon" | "unknown";
export type OpeningStateInput = {
  normalizedOpeningStatus?: string;
  normalizedOpeningLabel?: string;
  openStatus?: string;
  openStatusLabel?: string;
  openNow?: boolean | null;
  businessStatus?: string | null;
};

/** State governs display; labels are accepted only as exact legacy sentinels. */
export function openingStateForDisplay(place: OpeningStateInput): OpeningDisplayState {
  if (["CLOSED_PERMANENTLY", "CLOSED_TEMPORARILY"].includes(place.businessStatus ?? "")) return "closed";
  const normalized = place.normalizedOpeningStatus;
  if (normalized === "closed" || normalized === "unknown") return normalized;
  if (normalized === "closingSoon" || normalized === "closing_soon") return "closingSoon";
  if (normalized === "open") return place.openStatus === "closing_soon" ? "closingSoon" : "open";
  if (place.openNow === false) return "closed";
  if (place.openStatus === "closing_soon") return "closingSoon";
  if (place.openNow === true || place.openStatus === "open") return "open";
  if (["closed_now", "closed_today", "permanently_closed", "temporarily_closed"].includes(place.openStatus ?? "")) return "closed";
  const legacy = place.normalizedOpeningLabel ?? place.openStatusLabel;
  const keys: Record<OpeningDisplayState, string[]> = {
    open: ["place.open", "nativeQa.todayOpen"],
    closed: ["place.closed", "nativeQa.legacyClosed", "nativeQa.closedToday", "nativeQa.closedNow", "nativeQa.permanentlyClosed", "nativeQa.temporarilyClosed"],
    closingSoon: ["nativeQa.closingSoon"],
    unknown: ["place.hoursUnknown", "nativeQa.legacyUnknown"],
  };
  for (const state of Object.keys(keys) as OpeningDisplayState[]) {
    if (keys[state].some((key) => legacy === translate("zh-TW", key))) return state;
  }
  return "unknown";
}

export function openingStatusLabelForLocale(locale: Locale, status: OpeningDisplayState): string {
  return translate(locale, status === "closingSoon" ? "nativeQa.closingSoon" : `place.${status === "unknown" ? "hoursUnknown" : status}`);
}

export function placeOpeningStatusLabel(place: OpeningStateInput, locale: Locale = "zh-TW"): string {
  return openingStatusLabelForLocale(locale, openingStateForDisplay(place));
}

export type PlaceOpeningDisplay = {
  label: string;
  hoursLine: string | null;
  closingSoonNote: string | null;
  nextOpenHint: string | null;
};

function extractCloseTimeFromTodayHoursLabel(label: string): string | null {
  const trimmed = label.replace(/^今日\s*/, "").trim();
  const range = trimmed.match(/(\d{1,2}:\d{2})\s*[–\-~～至]\s*(\d{1,2}:\d{2})/);
  if (range) return range[2] ?? null;
  return null;
}

function parseNextOpenHint(hint: string): { day: "today" | "tomorrow" | "other"; time: string } {
  const timeMatch = hint.match(/(\d{1,2}:\d{2})/);
  const time = timeMatch?.[1] ?? "";
  if (hint.startsWith("今天")) return { day: "today", time };
  if (hint.startsWith("明天")) return { day: "tomorrow", time };
  return { day: "other", time };
}

/** 詳情頁：單一營業狀態文案（Google openNow / nextOpenTime / nextCloseTime） */
export function resolvePlaceDetailOpeningLine(
  place: OpeningStateInput & Partial<Pick<PlaceResult, "nextOpenHint" | "todayHoursLabel" | "openUntilTime">>,
  locale: Locale = "zh-TW",
): string {
  if (place.businessStatus === "CLOSED_PERMANENTLY") return translate(locale, "nativeQa.permanentlyClosed");
  if (place.businessStatus === "CLOSED_TEMPORARILY") return translate(locale, "nativeQa.temporarilyClosed");
  const state = openingStateForDisplay(place);
  const label = openingStatusLabelForLocale(locale, state);
  if (state === "open" || state === "closingSoon") {
    const time = place.openUntilTime?.trim() || extractCloseTimeFromTodayHoursLabel(place.todayHoursLabel ?? "");
    return time ? `${label} · ${translate(locale, "nativeQa.openUntil", { time })}` : label;
  }
  if (state === "closed") {
    const hint = place.nextOpenHint?.trim();
    if (hint) {
      const parsed = parseNextOpenHint(hint);
      if (parsed.time && parsed.day !== "other") {
        const closed = parsed.day === "tomorrow" ? translate(locale, "nativeQa.legacyClosed") : label;
        return `${closed} · ${translate(locale, parsed.day === "today" ? "nativeQa.nextToday" : "nativeQa.nextTomorrow", { time: parsed.time })}`;
      }
    }
    if (isClosedHoursText(place.todayHoursLabel ?? "")) return translate(locale, "nativeQa.legacyClosed");
  }
  return label;
}

/** 詳情頁單一營業資訊區塊（避免 status badge 與 hours 矛盾） */
export function resolvePlaceOpeningDisplay(
  place: Pick<
    PlaceResult,
    | "normalizedOpeningLabel"
    | "normalizedOpeningStatus"
    | "openStatusLabel"
    | "openStatus"
    | "openNow"
    | "todayHoursLabel"
    | "closingSoonNote"
    | "nextOpenHint"
  >,
): PlaceOpeningDisplay {
  const label = placeOpeningStatusLabel(place);
  const openNow = place.openNow ?? null;

  let hoursLine = (place.todayHoursLabel ?? "").trim() || null;
  if (hoursLine) {
    if (openNow === true && (isClosedHoursText(hoursLine) || hoursLine === "休息中" || hoursLine === "今日休息")) {
      hoursLine = "今日營業中";
    }
  if (hoursLine === label || hoursLine === `今日 ${label}`) {
    hoursLine = null;
  }
  if (label === "營業中" && hoursLine === "今日營業中") {
    hoursLine = null;
  }
    if (openNow === true && hoursLine === "營業資訊暫缺") {
      hoursLine = "今日營業中";
    }
  } else if (openNow === true) {
    hoursLine = "今日營業中";
  }

  const closingSoonNote =
    openNow === true ? (place.closingSoonNote?.trim() || null) : null;
  const nextOpenHint =
    openNow === false ? (place.nextOpenHint?.trim() || null) : null;

  return {
    label,
    hoursLine: hoursLine && hoursLine !== label ? hoursLine : null,
    closingSoonNote,
    nextOpenHint,
  };
}

/** 將 normalized 營業狀態寫入 PlaceResult */
export function applyNormalizedOpeningToPlaceResult(
  place: PlaceResult,
  hours: PlaceHoursData,
): PlaceResult {
  const norm = normalizeOpeningStatus(hours);
  const availability = derivePlaceAvailability(hours, { context: "now" });
  const todayHoursLabel = buildTodayHoursLine(hours, norm);

  return {
    ...place,
    openNow: norm.openNow,
    normalizedOpeningStatus: norm.status,
    normalizedOpeningLabel: norm.label,
    normalizedOpeningSource: norm.source,
    openStatus: normalizedOpeningStatusToPlaceOpenStatus(norm.status),
    openStatusLabel: norm.label,
    todayHoursLabel,
    closingSoonNote: norm.openNow === true ? availability.closingSoonNote : "",
    nextOpenHint: norm.openNow === false ? availability.nextOpenHint : "",
    openUntilTime: norm.openNow === true ? availability.openUntilTime : "",
    businessStatus: availability.businessStatus ?? place.businessStatus,
    regularOpeningHours: hours.regularOpeningHours ?? place.regularOpeningHours,
    utcOffsetMinutes: hours.utcOffsetMinutes ?? place.utcOffsetMinutes,
  };
}

/** 從已 flatten 的 place 欄位還原 view（cache / handoff） */
export function normalizedOpeningViewFromPlace(
  place: Pick<
    PlaceResult,
    | "openNow"
    | "normalizedOpeningStatus"
    | "normalizedOpeningLabel"
    | "normalizedOpeningSource"
    | "openStatus"
    | "openStatusLabel"
  >,
): NormalizedOpeningView {
  if (place.normalizedOpeningStatus && place.normalizedOpeningLabel) {
    return {
      status: place.normalizedOpeningStatus,
      label: place.normalizedOpeningLabel as NormalizedOpeningView["label"],
      source: place.normalizedOpeningSource ?? "unknown",
      openNow: place.openNow ?? null,
    };
  }

  const label = placeOpeningStatusLabel(place);
  let status: NormalizedOpeningStatusValue = "unknown";
  if (place.openNow === true || label === "營業中") status = "open";
  else if (place.openNow === false || label === "休息中") status = "closed";

  return {
    status,
    label: label as NormalizedOpeningView["label"],
    source: "unknown",
    openNow: place.openNow ?? null,
  };
}
