export type OpenStatus = "open" | "closing_soon" | "closed_today" | "unknown";

export type OpenStatusInfo = {
  status: OpenStatus;
  label: "" | "營業中" | "即將打烊" | "今日休息";
};

type HoursInput = {
  businessStatus?: string | null;
  currentOpeningHours?: {
    openNow?: boolean;
    nextCloseTime?: string;
  } | null;
};

const CLOSING_SOON_MS = 60 * 60 * 1000;

export function deriveOpenStatus(input: HoursInput): OpenStatusInfo {
  const biz = input.businessStatus?.toUpperCase() ?? "";
  if (biz.includes("CLOSED")) {
    return { status: "closed_today", label: "今日休息" };
  }

  const hours = input.currentOpeningHours;
  if (!hours || hours.openNow === undefined) {
    return { status: "unknown", label: "" };
  }

  if (!hours.openNow) {
    return { status: "closed_today", label: "今日休息" };
  }

  if (hours.nextCloseTime) {
    const closeAt = new Date(hours.nextCloseTime).getTime();
    const diff = closeAt - Date.now();
    if (diff > 0 && diff <= CLOSING_SOON_MS) {
      return { status: "closing_soon", label: "即將打烊" };
    }
  }

  return { status: "open", label: "營業中" };
}

/** 營業中優先；休息中排後 */
export function openStatusSortWeight(status: OpenStatus): number {
  switch (status) {
    case "open":
      return 0;
    case "closing_soon":
      return 1;
    case "unknown":
      return 2;
    case "closed_today":
      return 3;
    default:
      return 2;
  }
}
