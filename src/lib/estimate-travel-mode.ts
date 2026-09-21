import { translate } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/types";
import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";
import type { LegDurationEstimate } from "@/lib/routes/types";
import type { WeatherSummary } from "@/lib/weather-types";
import { formatDistanceLabel } from "@/lib/map-explore";

export type TravelModeId = "walk" | "motorcycle" | "drive" | "transit" | "taxi";

export const TRAVEL_MODE_ORDER: TravelModeId[] = ["walk", "motorcycle", "drive", "transit", "taxi"];

export const TRAVEL_MODE_LABEL: Record<TravelModeId, string> = {
  walk: "步行",
  motorcycle: "騎車",
  drive: "開車",
  transit: "大眾運輸",
  taxi: "計程車",
};

export const TRANSIT_MVP_NOTICE = "實際班次與轉乘請以 Google Maps / 交通業者資訊為準";

export const TAXI_NAV_TOAST = "將以開車路線開啟，可再於地圖 App 選擇計程車服務";

export type TravelModeEstimate = {
  id: TravelModeId;
  label: string;
  minutes: number;
  distanceMeters: number;
  distanceLabel: string;
  costLabel?: string;
  hint: string;
  recommended?: boolean;
  durationSource?: "route" | "estimated" | "unavailable";
  available?: boolean;
};

export const LONG_DISTANCE_TRANSPORT_THRESHOLD_METERS = 1_000_000;

function estimateWalkMinutes(meters: number): number {
  return Math.max(1, Math.round(meters / 75));
}

export const WALK_FRIENDLY_MAX_METERS = 1200;
export const WALK_FRIENDLY_MAX_MINUTES = 20;

export function buildWalkingTransportHint(
  distanceMeters: number,
  walkingMinutes: number,
  locale: Locale = "zh-TW",
): string {
  if (distanceMeters <= WALK_FRIENDLY_MAX_METERS && walkingMinutes <= WALK_FRIENDLY_MAX_MINUTES) {
    return translate(locale, "uiCoverage.walkNear");
  }
  return translate(locale, "uiCoverage.walkFar");
}

function estimateMotorcycleMinutes(meters: number, driveMin?: number): number {
  if (driveMin != null) return Math.max(2, Math.round(driveMin * 0.72));
  return Math.max(2, Math.round(meters / 400));
}

function estimateDriveMinutes(meters: number): number {
  const km = meters / 1000;
  return Math.max(2, Math.round(km * 2.8 + 3));
}

function estimateTransitMinutes(meters: number, driveMin?: number): number {
  if (driveMin != null) return Math.max(driveMin + 4, Math.round(driveMin * 1.35));
  const km = meters / 1000;
  return Math.max(5, Math.round(km * 4 + 8));
}

function estimateTaxiMinutes(driveMin?: number, meters?: number): number {
  if (driveMin != null) return Math.max(2, Math.round(driveMin * 0.85));
  if (meters != null) return estimateDriveMinutes(meters);
  return 8;
}

function sortModesByOrder(modes: TravelModeEstimate[]): TravelModeEstimate[] {
  const order = new Map(TRAVEL_MODE_ORDER.map((id, i) => [id, i]));
  return [...modes].sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
}

/** 本地估算（無 API 時 fallback） */
export function estimateTravelModesLocal(
  distanceMeters: number,
  durations?: Partial<LegDurationEstimate>,
  locale: Locale = "zh-TW",
): TravelModeEstimate[] {
  const distLabel = formatDistanceLabel(distanceMeters);
  const walkMin = durations?.walk ?? estimateWalkMinutes(distanceMeters);
  const driveMin = durations?.drive ?? estimateDriveMinutes(distanceMeters);
  const motorcycleMin = estimateMotorcycleMinutes(distanceMeters, driveMin);
  const transitMin = durations?.transit ?? estimateTransitMinutes(distanceMeters, driveMin);
  const taxiMin = estimateTaxiMinutes(driveMin, distanceMeters);
  const isLongDistance = distanceMeters > LONG_DISTANCE_TRANSPORT_THRESHOLD_METERS;
  const routeSource = (value: number | undefined): "route" | "estimated" =>
    value != null ? "route" : "estimated";

  return sortModesByOrder([
    {
      id: "walk",
      label: translate(locale, "uiCoverage.walk"),
      minutes: walkMin,
      distanceMeters,
      distanceLabel: distLabel,
      hint: buildWalkingTransportHint(distanceMeters, walkMin, locale),
      durationSource: isLongDistance ? "unavailable" : routeSource(durations?.walk),
      available: !isLongDistance,
    },
    {
      id: "motorcycle",
      label: translate(locale, "uiCoverage.motorcycle"),
      minutes: motorcycleMin,
      distanceMeters,
      distanceLabel: distLabel,
      hint: isLongDistance
        ? translate(locale, "uiCoverage.motorcycleFar")
        : translate(locale, "uiCoverage.motorcycleShort"),
      durationSource: isLongDistance ? "unavailable" : "estimated",
      available: !isLongDistance,
    },
    {
      id: "drive",
      label: translate(locale, "uiCoverage.drive"),
      minutes: driveMin,
      distanceMeters,
      distanceLabel: distLabel,
      hint: translate(locale, "uiCoverage.driveParking"),
      durationSource:
        isLongDistance && durations?.drive == null ? "unavailable" : routeSource(durations?.drive),
      available: !isLongDistance || durations?.drive != null,
    },
    {
      id: "transit",
      label: translate(locale, "uiCoverage.transit"),
      minutes: transitMin,
      distanceMeters,
      distanceLabel: distLabel,
      hint:
        isLongDistance && durations?.transit == null
          ? translate(locale, "uiCoverage.transitUnavailable")
          : translate(locale, "uiCoverage.transitLong"),
      durationSource:
        isLongDistance && durations?.transit == null
          ? "unavailable"
          : routeSource(durations?.transit),
      available: !isLongDistance || durations?.transit != null,
    },
    {
      id: "taxi",
      label: translate(locale, "uiCoverage.taxi"),
      minutes: taxiMin,
      distanceMeters,
      distanceLabel: distLabel,
      hint: translate(locale, "uiCoverage.taxiRain"),
      durationSource: isLongDistance ? "unavailable" : routeSource(durations?.drive),
      available: !isLongDistance,
    },
  ]);
}

export function mergeTravelDurations(
  local: TravelModeEstimate[],
  durations: LegDurationEstimate,
  locale: Locale = "zh-TW",
): TravelModeEstimate[] {
  return estimateTravelModesLocal(
    durations.distanceMeters || local[0]?.distanceMeters || 0,
    durations,
    locale,
  );
}

export type TransportRecommendContext = {
  locale?: Locale;
  weather?: WeatherSummary | null;
  hour?: number;
  profile?: UserProfileForReason | null;
  distanceMeters: number;
  /** 起點或使用者是否在台灣境內 */
  inTaiwan?: boolean;
};

function isRain(weather?: WeatherSummary | null): boolean {
  return (
    weather?.recommendation === "indoor" ||
    (weather?.precipProbability != null && weather.precipProbability >= 0.45)
  );
}

/** 短程城市交通推薦（不綁定國家或使用者所在地） */
function recommendLocalMode(
  modes: TravelModeEstimate[],
  dist: number,
  ctx: TransportRecommendContext,
): { modeId: TravelModeId; tip: string } | null {
  const locale = ctx.locale ?? "zh-TW";
  const hour = ctx.hour ?? new Date().getHours();
  const isNight = hour >= 20 || hour < 6;
  const pace = ctx.profile?.pace;
  const blob = [
    ctx.profile?.travelStyle ?? "",
    ctx.profile?.personalitySummary ?? "",
    ...(ctx.profile?.interests ?? []),
  ].join(" ");

  if (dist < 1000) {
    return {
      modeId: "walk",
      tip: translate(locale, "uiCoverage.walkVeryNear"),
    };
  }

  if (dist >= 1000 && dist <= 8000) {
    const motorcycle = modes.find((m) => m.id === "motorcycle");
    if (motorcycle) {
      if (isNight) {
        return {
          modeId: "motorcycle",
          tip: translate(locale, "uiCoverage.motorcycleNight"),
        };
      }
      if (pace === "active" || /趕|密集|效率/i.test(blob)) {
        return {
          modeId: "motorcycle",
          tip: translate(locale, "uiCoverage.motorcycleBusy"),
        };
      }
      return {
        modeId: "motorcycle",
        tip: translate(locale, "uiCoverage.motorcycleShort"),
      };
    }
  }

  if (dist > 8000) {
    const transit = modes.find((m) => m.id === "transit");
    if (transit) {
      return { modeId: "transit", tip: translate(locale, "uiCoverage.transitFar") };
    }
    const drive = modes.find((m) => m.id === "drive");
    if (drive) {
      return { modeId: "drive", tip: translate(locale, "uiCoverage.driveFar") };
    }
  }

  return null;
}

/** Roamie 智慧推薦交通方式 */
export function recommendTransportMode(
  modes: TravelModeEstimate[],
  ctx: TransportRecommendContext,
): { modeId: TravelModeId; tip: string } {
  const locale = ctx.locale ?? "zh-TW";
  const rain = isRain(ctx.weather);
  const dist = ctx.distanceMeters;

  if (dist > LONG_DISTANCE_TRANSPORT_THRESHOLD_METERS) {
    const routed =
      modes.find(
        (mode) =>
          mode.available !== false && mode.durationSource === "route" && mode.id === "transit",
      ) ?? modes.find((mode) => mode.available !== false && mode.durationSource === "route");
    return {
      modeId: routed?.id ?? "transit",
      tip: routed
        ? translate(locale, "uiCoverage.longRoute")
        : translate(locale, "uiCoverage.longUnavailable"),
    };
  }

  if (rain) {
    const taxi = modes.find((m) => m.id === "taxi");
    const drive = modes.find((m) => m.id === "drive");
    const pick = taxi ?? drive ?? modes[0];
    return {
      modeId: pick.id,
      tip: translate(locale, "uiCoverage.rainRide"),
    };
  }

  const local = recommendLocalMode(modes, dist, ctx);
  if (local) return local;

  const hour = ctx.hour ?? new Date().getHours();
  const isNight = hour >= 20 || hour < 6;
  const pace = ctx.profile?.pace;
  const blob = [
    ctx.profile?.travelStyle ?? "",
    ctx.profile?.personalitySummary ?? "",
    ...(ctx.profile?.interests ?? []),
  ].join(" ");

  if (dist < 1000) {
    return {
      modeId: "walk",
      tip: translate(locale, "uiCoverage.walkLeisure"),
    };
  }

  if (isNight) {
    const taxi = modes.find((m) => m.id === "taxi");
    const drive = modes.find((m) => m.id === "drive");
    const pick = taxi ?? drive ?? modes[0];
    return {
      modeId: pick.id,
      tip: translate(locale, "uiCoverage.nightTravel"),
    };
  }

  if (dist < 2500 && (pace === "slow" || /散步|慢|步行/i.test(blob))) {
    return {
      modeId: "walk",
      tip: translate(locale, "uiCoverage.walkStreets"),
    };
  }

  if (dist > 8000) {
    const transit = modes.find((m) => m.id === "transit");
    if (transit) {
      return {
        modeId: "transit",
        tip: translate(locale, "uiCoverage.transitFurther"),
      };
    }
    const drive = modes.find((m) => m.id === "drive");
    if (drive) {
      return { modeId: "drive", tip: translate(locale, "uiCoverage.driveTime") };
    }
  }

  if (/計程車|舒適|不想走/i.test(blob) && dist > 1500) {
    return { modeId: "taxi", tip: translate(locale, "uiCoverage.taxiPreference") };
  }

  const motorcycle = modes.find((m) => m.id === "motorcycle");
  if (motorcycle && dist >= 1000 && dist <= 8000) {
    return {
      modeId: "motorcycle",
      tip: translate(locale, "uiCoverage.motorcycleCity"),
    };
  }

  const walk = modes.find((m) => m.id === "walk");
  if (walk && walk.minutes <= 18) {
    return { modeId: "walk", tip: translate(locale, "uiCoverage.walkMinutes") };
  }

  const transit = modes.find((m) => m.id === "transit");
  if (transit && dist > 3000) {
    return { modeId: "transit", tip: translate(locale, "uiCoverage.transitTransfer") };
  }

  return {
    modeId: "drive",
    tip: translate(locale, "uiCoverage.driveTime"),
  };
}

export function applyRecommendedMode(
  modes: TravelModeEstimate[],
  modeId: TravelModeId,
): TravelModeEstimate[] {
  return sortModesByOrder(
    modes.map((m) => ({ ...m, recommended: m.id === modeId && m.available !== false })),
  );
}

/** 預設選取的交通方式（距離 / 天氣 / 時段 / 地區） */
export function getDefaultTransportMode(ctx: TransportRecommendContext): TravelModeId {
  const local = estimateTravelModesLocal(ctx.distanceMeters, undefined, ctx.locale);
  return recommendTransportMode(local, ctx).modeId;
}
