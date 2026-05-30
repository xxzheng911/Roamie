/**
 * 全域地點推薦規則：營業狀態、排序、過濾。
 * 探索地圖、AI 聊天、心情推薦、行程規劃、收藏前推薦共用。
 */

export type PlaceBusinessStatus =
  | "OPERATIONAL"
  | "CLOSED_TEMPORARILY"
  | "CLOSED_PERMANENTLY"
  | string;

export type PlaceOpenStatus =
  | "open"
  | "closing_soon"
  | "closed_now"
  | "permanently_closed"
  | "temporarily_closed"
  | "unknown";

/** Google Places 營業時間原始欄位 */
export type PlaceHoursData = {
  businessStatus?: string | null;
  currentOpeningHours?: {
    openNow?: boolean;
    nextCloseTime?: string;
    nextOpenTime?: string;
    weekdayDescriptions?: string[];
  } | null;
  regularOpeningHours?: {
    weekdayDescriptions?: string[];
    periods?: Array<{
      open?: { day?: number; hour?: number; minute?: number };
      close?: { day?: number; hour?: number; minute?: number };
    }>;
  } | null;
  utcOffsetMinutes?: number | null;
};

export type PlaceAvailability = {
  businessStatus: string | null;
  openStatus: PlaceOpenStatus;
  /** 卡片顯示：營業中 / 目前未營業 / 即將打烊；已停業則不推薦故無 label */
  displayStatus: string;
  todayHoursLabel: string;
  closingSoonNote: string;
  nextOpenHint: string;
  sortWeight: number;
  isRecommendable: boolean;
};

export type FilterPlacesContext = "now" | "scheduled" | "lenient";

export type FilterPlacesOptions = {
  context?: FilterPlacesContext;
  /** 用於行程：判斷該時間是否營業 */
  at?: Date;
  /** 行程項目時間 HH:mm */
  atTime?: string;
};

export type PlaceIdentity = {
  name?: string;
  type?: string;
};

const CLOSING_SOON_MS = 60 * 60 * 1000;

/** 深夜模式：22:00–04:59 */
export function isLateNightMode(at: Date = new Date()): boolean {
  const h = at.getHours();
  return h >= 22 || h < 5;
}

function placeBlob(name: string, type?: string): string {
  return `${name} ${type ?? ""}`.toLowerCase();
}

/** 戶外景觀／河岸：深夜仍可推薦（不因打烊狀態排除） */
export function isLateNightScenicAccessible(name: string, type?: string): boolean {
  const blob = placeBlob(name, type);
  if (/夜景|觀景|展望|燈塔|河岸|河堤|愛河|碼頭|港區|海灣|海邊|海岸|堤|步道|散步|河濱|绿道|公園|park|駁二|夜市|waterfront|viewpoint/i.test(blob)) {
    return true;
  }
  return false;
}

/** 深夜不適合推薦的類型（百貨、早午餐、一般日間景點等） */
export function isLateNightUnsuitableType(name: string, type?: string): boolean {
  const blob = placeBlob(name, type);
  if (
    /酒吧|bar|夜店|night club|pub|宵夜|夜市|居酒|ktv|卡拉|24小時|24小|二十四小時|night|夜景|河岸|便利|超商|溫泉|宵夜/i.test(
      blob,
    )
  ) {
    return false;
  }
  if (
    /百貨|department|shopping mall|文創|展覽|博物館|museum|美術館|gallery|景點|觀光|早午餐|早餐|brunch|蛋餅|豆漿|吐司|晨間|morning coffee/i.test(
      blob,
    )
  ) {
    return true;
  }
  if (/咖啡|cafe|coffee|書店|書局/i.test(blob) && !/24|深夜|night/i.test(blob)) {
    return true;
  }
  return false;
}

/** 時段與店型明顯不合 → 應完全排除 */
export function isTimePeriodMismatch(name: string, type: string | undefined, at: Date): boolean {
  const blob = placeBlob(name, type);
  const hour = at.getHours();
  const late = hour >= 22 || hour < 5;
  const morning = hour >= 5 && hour < 11;

  if (late) {
    return isLateNightUnsuitableType(name, type);
  }
  if (morning) {
    return /酒吧|夜店|night club|居酒屋|lounge bar|pub/i.test(blob);
  }
  if (hour >= 17 && hour < 22) {
    return /早餐|早午餐|brunch|蛋餅店/i.test(blob);
  }
  return false;
}

function isOpeningSoonClosed(availability: PlaceAvailability): boolean {
  return (
    availability.openStatus === "closed_now" &&
    !!availability.nextOpenHint?.trim()
  );
}

/** weekdayDescriptions 順序：週一 (0) … 週日 (6) */
const JS_DAY_TO_WEEKDAY_IDX: Record<number, number> = {
  0: 6,
  1: 0,
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
};

function localInstant(at: Date, utcOffsetMinutes?: number | null): Date {
  if (utcOffsetMinutes == null) return at;
  const utcMs = at.getTime() + at.getTimezoneOffset() * 60_000;
  return new Date(utcMs + utcOffsetMinutes * 60_000);
}

function parseScheduledAt(at: Date, atTime?: string): Date {
  if (!atTime?.trim()) return at;
  const m = atTime.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return at;
  const d = new Date(at);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d;
}

function formatTimeHm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatNextOpenLabel(nextOpen: Date, now: Date): string {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const startOfDayAfter = new Date(startOfTomorrow);
  startOfDayAfter.setDate(startOfDayAfter.getDate() + 1);

  const hm = formatTimeHm(nextOpen.getHours(), nextOpen.getMinutes());
  if (nextOpen >= startOfToday && nextOpen < startOfTomorrow) {
    return `今天 ${hm} 開始營業`;
  }
  if (nextOpen >= startOfTomorrow && nextOpen < startOfDayAfter) {
    return `明天 ${hm} 開始營業`;
  }
  const md = `${nextOpen.getMonth() + 1}/${nextOpen.getDate()}`;
  return `${md} ${hm} 開始營業`;
}

function findNextOpenFromPeriods(data: PlaceHoursData, at: Date): Date | null {
  const periods = data.regularOpeningHours?.periods;
  if (!periods?.length) return null;

  const local = localInstant(at, data.utcOffsetMinutes);
  const nowMin = local.getHours() * 60 + local.getMinutes();
  const todayDow = local.getDay();

  let best: Date | null = null;

  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    const dow = (todayDow + dayOffset) % 7;
    for (const period of periods) {
      if (period.open?.day !== dow) continue;
      const oh = period.open.hour ?? 0;
      const om = period.open.minute ?? 0;
      const openMin = oh * 60 + om;
      if (dayOffset === 0 && openMin <= nowMin) continue;

      const candidate = new Date(local);
      candidate.setDate(candidate.getDate() + dayOffset);
      candidate.setHours(oh, om, 0, 0);
      if (!best || candidate < best) best = candidate;
    }
    if (best) break;
  }

  return best;
}

function getTodayHoursFromDescriptions(data: PlaceHoursData, at: Date): string {
  const desc =
    data.regularOpeningHours?.weekdayDescriptions ??
    data.currentOpeningHours?.weekdayDescriptions;
  if (!desc?.length) return "";

  const local = localInstant(at, data.utcOffsetMinutes);
  const idx = JS_DAY_TO_WEEKDAY_IDX[local.getDay()];
  const line = desc[idx];
  if (!line) return "";

  const colon = line.indexOf(":");
  const hoursPart = colon >= 0 ? line.slice(colon + 1).trim() : line.trim();
  return hoursPart || line;
}

function isOpenAtScheduled(data: PlaceHoursData, at: Date, atTime?: string): boolean | null {
  const periods = data.regularOpeningHours?.periods;
  if (!periods?.length) return null;

  const when = parseScheduledAt(
    localInstant(at, data.utcOffsetMinutes),
    atTime,
  );
  const dow = when.getDay();
  const min = when.getHours() * 60 + when.getMinutes();

  for (const period of periods) {
    if (period.open?.day !== dow) continue;
    const openMin = (period.open.hour ?? 0) * 60 + (period.open.minute ?? 0);
    let closeMin = 24 * 60;
    let closeDow = dow;
    if (period.close) {
      closeDow = period.close.day ?? dow;
      closeMin = (period.close.hour ?? 0) * 60 + (period.close.minute ?? 0);
    }
    if (closeDow === dow && closeMin > openMin) {
      if (min >= openMin && min < closeMin) return true;
    } else if (closeDow !== dow) {
      if (min >= openMin) return true;
    }
  }
  return false;
}

export function derivePlaceAvailability(
  data: PlaceHoursData,
  options: FilterPlacesOptions = {},
): PlaceAvailability {
  const context = options.context ?? "now";
  const at = options.at ?? new Date();
  const biz = (data.businessStatus ?? "").toUpperCase();

  if (biz === "CLOSED_PERMANENTLY") {
    return {
      businessStatus: data.businessStatus ?? null,
      openStatus: "permanently_closed",
      displayStatus: "",
      todayHoursLabel: "",
      closingSoonNote: "",
      nextOpenHint: "",
      sortWeight: 99,
      isRecommendable: false,
    };
  }

  if (biz === "CLOSED_TEMPORARILY") {
    return {
      businessStatus: data.businessStatus ?? null,
      openStatus: "temporarily_closed",
      displayStatus: "",
      todayHoursLabel: "",
      closingSoonNote: "",
      nextOpenHint: "",
      sortWeight: 98,
      isRecommendable: false,
    };
  }

  const todayRaw = getTodayHoursFromDescriptions(data, at);
  const hasHoursData =
    data.currentOpeningHours?.openNow !== undefined ||
    !!todayRaw ||
    !!data.regularOpeningHours?.periods?.length;

  const todayHoursLabel = hasHoursData
    ? todayRaw
      ? `今日 ${todayRaw}`
      : "營業時間待確認"
    : "營業時間待確認";

  if (context === "scheduled") {
    const scheduledOpen = isOpenAtScheduled(data, at, options.atTime);
    if (scheduledOpen === false) {
      return {
        businessStatus: data.businessStatus ?? null,
        openStatus: "closed_now",
        displayStatus: "目前未營業",
        todayHoursLabel,
        closingSoonNote: "",
        nextOpenHint: "",
        sortWeight: 10,
        isRecommendable: false,
      };
    }
    if (scheduledOpen === true) {
      return {
        businessStatus: data.businessStatus ?? null,
        openStatus: "open",
        displayStatus: "營業中",
        todayHoursLabel,
        closingSoonNote: "",
        nextOpenHint: "",
        sortWeight: 0,
        isRecommendable: true,
      };
    }
  }

  const hours = data.currentOpeningHours;
  if (!hours || hours.openNow === undefined) {
    const inferredNow = isOpenAtScheduled(data, at);
    if (inferredNow === true) {
      return {
        businessStatus: data.businessStatus ?? null,
        openStatus: "open",
        displayStatus: "營業中",
        todayHoursLabel,
        closingSoonNote: "",
        nextOpenHint: "",
        sortWeight: 0,
        isRecommendable: true,
      };
    }
    if (inferredNow === false) {
      let nextOpenHint = "";
      const next = findNextOpenFromPeriods(data, at);
      if (next) {
        nextOpenHint = formatNextOpenLabel(next, localInstant(at, data.utcOffsetMinutes));
      }
      return {
        businessStatus: data.businessStatus ?? null,
        openStatus: "closed_now",
        displayStatus: "目前未營業",
        todayHoursLabel,
        closingSoonNote: "",
        nextOpenHint,
        sortWeight: nextOpenHint ? 5 : 12,
        isRecommendable: context === "lenient",
      };
    }
    const lateNight = isLateNightMode(at);
    return {
      businessStatus: data.businessStatus ?? null,
      openStatus: "unknown",
      displayStatus: "",
      todayHoursLabel,
      closingSoonNote: "",
      nextOpenHint: "",
      sortWeight: lateNight ? 6 : 4,
      isRecommendable: true,
    };
  }

  if (!hours.openNow) {
    let nextOpenHint = "";
    if (hours.nextOpenTime) {
      nextOpenHint = formatNextOpenLabel(new Date(hours.nextOpenTime), localInstant(at, data.utcOffsetMinutes));
    } else {
      const next = findNextOpenFromPeriods(data, at);
      if (next) {
        nextOpenHint = formatNextOpenLabel(next, localInstant(at, data.utcOffsetMinutes));
      }
    }
    return {
      businessStatus: data.businessStatus ?? null,
      openStatus: "closed_now",
      displayStatus: "目前未營業",
      todayHoursLabel,
      closingSoonNote: "",
      nextOpenHint,
      sortWeight: nextOpenHint ? 5 : 12,
      isRecommendable: context === "lenient",
    };
  }

  let closingSoonNote = "";
  if (hours.nextCloseTime) {
    const closeAt = new Date(hours.nextCloseTime).getTime();
    const diff = closeAt - at.getTime();
    if (diff > 0 && diff <= CLOSING_SOON_MS) {
      closingSoonNote = "即將打烊，建議先確認時間";
    }
  }

  return {
    businessStatus: data.businessStatus ?? null,
    openStatus: closingSoonNote ? "closing_soon" : "open",
    displayStatus: closingSoonNote ? "即將打烊" : "營業中",
    todayHoursLabel,
    closingSoonNote,
    nextOpenHint: "",
    sortWeight: closingSoonNote ? 1 : 0,
    isRecommendable: true,
  };
}

export type WithAvailability<T> = T & {
  availability: PlaceAvailability;
};

/**
 * 「現在」是否可推薦：營業中、即將打烊、即將營業；排除打烊、時段不合、深夜不合類型。
 */
export function isPlaceAvailableNow(
  data: PlaceHoursData,
  identity: PlaceIdentity,
  options: FilterPlacesOptions = {},
): boolean {
  const at = options.at ?? new Date();
  const context = options.context ?? "now";
  const name = identity.name ?? "";
  const type = identity.type ?? "";

  if (isTimePeriodMismatch(name, type, at)) return false;

  if (isLateNightMode(at) && isLateNightScenicAccessible(name, type)) return true;

  const availability = derivePlaceAvailability(data, { ...options, at, context });

  if (context === "scheduled") {
    if (!availability.isRecommendable) return false;
    return (
      availability.openStatus === "open" ||
      availability.openStatus === "unknown"
    );
  }

  if (availability.openStatus === "unknown") {
    if (isLateNightMode(at)) {
      return !isLateNightUnsuitableType(name, type);
    }
    return true;
  }

  if (!availability.isRecommendable) return false;

  if (availability.openStatus === "open" || availability.openStatus === "closing_soon") {
    return true;
  }

  if (isOpeningSoonClosed(availability)) {
    return true;
  }

  /** 心情／聊天推薦：保留休息中地點（卡片顯示「休息中」），只排除永久／暫停營業 */
  if (context === "lenient") {
    if (
      availability.openStatus === "permanently_closed" ||
      availability.openStatus === "temporarily_closed"
    ) {
      return false;
    }
    return availability.isRecommendable;
  }

  return false;
}

/** 推薦管線：只保留現在適合推薦的地點 */
export function filterOpenPlaces<T>(
  items: T[],
  getHours: (item: T) => PlaceHoursData | null | undefined,
  getIdentity: (item: T) => PlaceIdentity,
  options: FilterPlacesOptions = {},
): T[] {
  const at = options.at ?? new Date();
  return items.filter((item) =>
    isPlaceAvailableNow(getHours(item) ?? {}, getIdentity(item), { ...options, at }),
  );
}

export function filterAvailablePlaces<T>(
  items: T[],
  getHours: (item: T) => PlaceHoursData | null | undefined,
  getIdentity?: (item: T) => PlaceIdentity,
  options: FilterPlacesOptions = {},
): T[] {
  const context = options.context ?? "now";

  if (context === "now" && getIdentity) {
    const filtered = filterOpenPlaces(items, getHours, getIdentity, options);
    return filtered
      .map((item) => ({
        item,
        availability: derivePlaceAvailability(getHours(item) ?? {}, {
          ...options,
          context: "now",
        }),
      }))
      .sort((a, b) => a.availability.sortWeight - b.availability.sortWeight)
      .map(({ item }) => item);
  }

  const scored = items
    .map((item) => {
      const raw = getHours(item);
      const availability = derivePlaceAvailability(raw ?? {}, options);
      return { item, availability };
    })
    .filter(({ availability }) => availability.isRecommendable);

  if (context === "scheduled") {
    return scored
      .filter(
        ({ availability }) =>
          availability.openStatus === "open" || availability.openStatus === "unknown",
      )
      .sort((a, b) => a.availability.sortWeight - b.availability.sortWeight)
      .map(({ item }) => item);
  }

  return scored
    .sort((a, b) => a.availability.sortWeight - b.availability.sortWeight)
    .map(({ item }) => item);
}

/** 將 availability 附加到推薦項目欄位 */
export function applyAvailabilityFields<T extends Record<string, unknown>>(
  item: T,
  availability: PlaceAvailability,
): T & {
  openStatusLabel: string;
  todayHoursLabel: string;
  closingSoonNote: string;
  nextOpenHint: string;
} {
  return {
    ...item,
    openStatusLabel: availability.displayStatus,
    todayHoursLabel: availability.todayHoursLabel,
    closingSoonNote: availability.closingSoonNote,
    nextOpenHint: availability.nextOpenHint,
  };
}

/** @deprecated 使用 derivePlaceAvailability */
export type OpenStatus = "open" | "closing_soon" | "closed_today" | "unknown";

export function deriveOpenStatus(input: PlaceHoursData): {
  status: OpenStatus;
  label: "" | "營業中" | "即將打烊" | "今日休息";
} {
  const a = derivePlaceAvailability(input, { context: "now" });
  if (!a.isRecommendable) return { status: "closed_today", label: "今日休息" };
  if (a.openStatus === "open") return { status: "open", label: "營業中" };
  if (a.openStatus === "closing_soon") return { status: "closing_soon", label: "即將打烊" };
  if (a.openStatus === "closed_now") return { status: "closed_today", label: "今日休息" };
  return { status: "unknown", label: "" };
}

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

export function appendReasonWithHours(
  reason: string,
  availability: PlaceAvailability,
): string {
  if (availability.closingSoonNote) {
    return `${reason}（${availability.closingSoonNote}）`;
  }
  if (availability.openStatus === "closed_now" && availability.nextOpenHint) {
    return `${reason}（${availability.nextOpenHint}）`;
  }
  if (availability.openStatus === "closed_now") {
    return `${reason}（目前未營業，可之後再去）`;
  }
  return reason;
}
