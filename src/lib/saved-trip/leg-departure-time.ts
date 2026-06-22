import type { RoamieItineraryItem, TripPlanSettings } from "@/lib/ai/types";
import { formatTimeMinutes, parseTimeMinutes } from "@/lib/saved-trip/recalculate-arrival-times";
import { legKeyForItem } from "@/lib/trip/trip-stop-mutations";

const DEFAULT_STAY_MINUTES = 60;
const TRIP_TZ = "+09:00";
const TRIP_TIME_ZONE = "Asia/Tokyo";

/** Google Directions TRANSIT 通常僅支援近期出發（約 7 天內） */
const TRANSIT_QUERY_MAX_DAYS_AHEAD = 7;

/** 有日期但無抵達時間時，預設從此時刻出發查詢 */
const DEFAULT_DEPART_HOUR = 9;
const DEFAULT_DEPART_MINUTE = 0;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function stayMinutes(settings: TripPlanSettings, item: RoamieItineraryItem): number {
  const mins = settings.legMinutes?.[legKeyForItem(item)];
  return mins != null && mins > 0 ? mins : DEFAULT_STAY_MINUTES;
}

/** 以 groupStopsByDate 的 dateKey 為準（比 item.date 更可靠） */
function resolveTripDate(prev: RoamieItineraryItem, dayDateKey: string): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dayDateKey)) {
    return dayDateKey;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(prev.date?.trim() ?? "")) {
    return prev.date!.trim();
  }
  return undefined;
}

function toRfc3339TripLocal(dateYmd: string, hour: number, minute: number): string {
  return `${dateYmd}T${pad2(hour)}:${pad2(minute)}:00${TRIP_TZ}`;
}

function dayOfWeekForTripDate(dateYmd: string): number {
  return new Date(`${dateYmd}T12:00:00${TRIP_TZ}`).getUTCDay();
}

function formatYmdFromTokyoDate(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TRIP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${day}`;
}

function tokyoClockParts(d = new Date()): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TRIP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { hour, minute };
}

function todayYmdTokyo(): string {
  return formatYmdFromTokyoDate(new Date());
}

function addDaysYmd(dateYmd: string, days: number): string {
  const base = new Date(`${dateYmd}T12:00:00${TRIP_TZ}`);
  base.setUTCDate(base.getUTCDate() + days);
  return formatYmdFromTokyoDate(base);
}

function nowTokyoIso(): string {
  const ymd = todayYmdTokyo();
  const { hour, minute } = tokyoClockParts();
  return toRfc3339TripLocal(ymd, hour, minute);
}

export type LegTransitSchedule = {
  tripDate: string;
  prevArrivalTime: string;
  departLocalTime: string;
  departHour: number;
  departMinute: number;
  tripDayOfWeek: number;
  plannedDepartureIso: string;
  /** 無明確行程日期（使用 now） */
  noTripDate?: boolean;
  /** 有日期但無抵達時間 */
  noArrivalTime?: boolean;
};

export type TransitDepartureQuery = {
  departureTime: string;
  queryDate: string;
  adjusted: boolean;
  reason?: string;
};

export type TransitTimeLogContext = {
  dayIndex: number;
  legIndex: number;
  legKey?: string;
};

export function logTransitTimeSource(
  schedule: LegTransitSchedule,
  query: TransitDepartureQuery,
  ctx: TransitTimeLogContext,
): void {
  const departureUnix = Math.floor(Date.parse(query.departureTime) / 1000);
  console.info(
    `[TRANSIT_TIME_SOURCE] tripDate=${schedule.tripDate} dayIndex=${ctx.dayIndex} legIndex=${ctx.legIndex} leg=${ctx.legKey ?? "n/a"} arrivalTime=${schedule.prevArrivalTime || "none"} departLocal=${schedule.departLocalTime} queryDate=${query.queryDate} departureISO=${query.departureTime} departureUnix=${departureUnix} adjusted=${query.adjusted} reason=${query.reason ?? "none"} noTripDate=${schedule.noTripDate ? "true" : "false"} noArrivalTime=${schedule.noArrivalTime ? "true" : "false"}`,
  );
}

/** 依前一站抵達 + 停留時間，組出 TRANSIT 查詢用的行程時間脈絡 */
export function buildLegTransitSchedule(
  prev: RoamieItineraryItem,
  settings: TripPlanSettings,
  dayDateKey: string,
): LegTransitSchedule | undefined {
  const tripDate = resolveTripDate(prev, dayDateKey);
  if (!tripDate) return undefined;

  const arrivalMinutes = parseTimeMinutes(prev.time);
  if (arrivalMinutes == null) {
    return {
      tripDate,
      prevArrivalTime: "",
      departLocalTime: formatTimeMinutes(DEFAULT_DEPART_HOUR * 60 + DEFAULT_DEPART_MINUTE),
      departHour: DEFAULT_DEPART_HOUR,
      departMinute: DEFAULT_DEPART_MINUTE,
      tripDayOfWeek: dayOfWeekForTripDate(tripDate),
      plannedDepartureIso: toRfc3339TripLocal(tripDate, DEFAULT_DEPART_HOUR, DEFAULT_DEPART_MINUTE),
      noArrivalTime: true,
    };
  }

  const departMinutes = arrivalMinutes + stayMinutes(settings, prev);
  const departHour = Math.floor(departMinutes / 60) % 24;
  const departMinute = departMinutes % 60;

  return {
    tripDate,
    prevArrivalTime: formatTimeMinutes(arrivalMinutes),
    departLocalTime: formatTimeMinutes(departMinutes),
    departHour,
    departMinute,
    tripDayOfWeek: dayOfWeekForTripDate(tripDate),
    plannedDepartureIso: toRfc3339TripLocal(tripDate, departHour, departMinute),
  };
}

/** 無行程日期時：使用東京現在時間查 TRANSIT */
export function defaultLegTransitSchedule(): LegTransitSchedule {
  const tripDate = todayYmdTokyo();
  const { hour, minute } = tokyoClockParts();
  return {
    tripDate,
    prevArrivalTime: "",
    departLocalTime: formatTimeMinutes(hour * 60 + minute),
    departHour: hour,
    departMinute: minute,
    tripDayOfWeek: dayOfWeekForTripDate(tripDate),
    plannedDepartureIso: nowTokyoIso(),
    noTripDate: true,
  };
}

/**
 * 依行程日期 + 抵達時間產生 Directions departure_time。
 * - 7 天內且未過期：用計畫出發時間
 * - 已過期：改用 now（東京）
 * - 超過 7 天：改為 7 天內同星期 + 相同時刻
 * - 無日期：defaultLegTransitSchedule（now）
 */
export function resolveTransitDepartureTimeForQuery(
  schedule: LegTransitSchedule,
): TransitDepartureQuery {
  if (schedule.noTripDate) {
    const nowIso = nowTokyoIso();
    return {
      departureTime: nowIso,
      queryDate: todayYmdTokyo(),
      adjusted: false,
      reason: "no_trip_date_use_now",
    };
  }

  const nowMs = Date.now();
  const maxMs = nowMs + TRANSIT_QUERY_MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000;
  const plannedMs = Date.parse(schedule.plannedDepartureIso);

  if (Number.isNaN(plannedMs)) {
    const nowIso = nowTokyoIso();
    return {
      departureTime: nowIso,
      queryDate: todayYmdTokyo(),
      adjusted: true,
      reason: "invalid_planned_use_now",
    };
  }

  if (plannedMs < nowMs) {
    const nowIso = nowTokyoIso();
    return {
      departureTime: nowIso,
      queryDate: todayYmdTokyo(),
      adjusted: true,
      reason: "past_use_now",
    };
  }

  if (plannedMs <= maxMs) {
    return {
      departureTime: schedule.plannedDepartureIso,
      queryDate: schedule.tripDate,
      adjusted: false,
      reason: "planned_in_window",
    };
  }

  let cursor = todayYmdTokyo();
  for (let i = 0; i < 14; i += 1) {
    if (dayOfWeekForTripDate(cursor) === schedule.tripDayOfWeek) {
      const candidateIso = toRfc3339TripLocal(
        cursor,
        schedule.departHour,
        schedule.departMinute,
      );
      const candidateMs = Date.parse(candidateIso);
      if (candidateMs >= nowMs && candidateMs <= maxMs) {
        return {
          departureTime: candidateIso,
          queryDate: cursor,
          adjusted: cursor !== schedule.tripDate,
          reason: "far_future_same_weekday",
        };
      }
    }
    cursor = addDaysYmd(cursor, 1);
  }

  const nowIso = nowTokyoIso();
  return {
    departureTime: nowIso,
    queryDate: todayYmdTokyo(),
    adjusted: true,
    reason: "fallback_use_now",
  };
}

export function resolveLegTransitDeparture(
  prev: RoamieItineraryItem,
  settings: TripPlanSettings,
  dayDateKey: string,
  logContext: TransitTimeLogContext,
): TransitDepartureQuery {
  const schedule = buildLegTransitSchedule(prev, settings, dayDateKey) ?? defaultLegTransitSchedule();
  const query = resolveTransitDepartureTimeForQuery(schedule);
  logTransitTimeSource(schedule, query, logContext);
  return query;
}

/** @deprecated 使用 buildLegTransitSchedule */
export function buildLegDepartureTimeIso(
  prev: RoamieItineraryItem,
  settings: TripPlanSettings,
  dayDateKey: string,
): string | undefined {
  return buildLegTransitSchedule(prev, settings, dayDateKey)?.plannedDepartureIso;
}
