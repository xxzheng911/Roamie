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
};

function estimateWalkMinutes(meters: number): number {
  return Math.max(1, Math.round(meters / 75));
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

function estimateTaxiCostTwd(meters: number): number {
  const km = meters / 1000;
  return Math.round(85 + km * 22);
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
): TravelModeEstimate[] {
  const distLabel = formatDistanceLabel(distanceMeters);
  const walkMin = durations?.walk ?? estimateWalkMinutes(distanceMeters);
  const driveMin = durations?.drive ?? estimateDriveMinutes(distanceMeters);
  const motorcycleMin = estimateMotorcycleMinutes(distanceMeters, driveMin);
  const transitMin = durations?.transit ?? estimateTransitMinutes(distanceMeters, driveMin);
  const taxiMin = estimateTaxiMinutes(driveMin, distanceMeters);
  const taxiCost = estimateTaxiCostTwd(distanceMeters);

  return sortModesByOrder([
    {
      id: "walk",
      label: "步行",
      minutes: walkMin,
      distanceMeters,
      distanceLabel: distLabel,
      hint: "適合順路散步看看附近。",
    },
    {
      id: "motorcycle",
      label: "騎車",
      minutes: motorcycleMin,
      distanceMeters,
      distanceLabel: distLabel,
      hint: "台灣市區移動通常最快，適合短距離探索。",
    },
    {
      id: "drive",
      label: "開車",
      minutes: driveMin,
      distanceMeters,
      distanceLabel: distLabel,
      hint: "停車方便時較省時間。",
    },
    {
      id: "transit",
      label: "大眾運輸",
      minutes: transitMin,
      distanceMeters,
      distanceLabel: distLabel,
      hint: "比較省體力，適合較長距離。",
    },
    {
      id: "taxi",
      label: "計程車",
      minutes: taxiMin,
      distanceMeters,
      distanceLabel: distLabel,
      costLabel: `約 NT$${taxiCost}`,
      hint: "下雨或不想淋雨時較舒適。",
    },
  ]);
}

export function mergeTravelDurations(
  local: TravelModeEstimate[],
  durations: LegDurationEstimate,
): TravelModeEstimate[] {
  return estimateTravelModesLocal(
    durations.distanceMeters || local[0]?.distanceMeters || 0,
    durations,
  );
}

export type TransportRecommendContext = {
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

/** 台灣市區交通推薦（1km 以下步行、1–8km 騎車、8km+ 開車/大眾） */
function recommendTaiwanMode(
  modes: TravelModeEstimate[],
  dist: number,
  ctx: TransportRecommendContext,
): { modeId: TravelModeId; tip: string } | null {
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
      tip: "距離很近，適合慢慢走過去。",
    };
  }

  if (dist >= 1000 && dist <= 8000) {
    const motorcycle = modes.find((m) => m.id === "motorcycle");
    if (motorcycle) {
      if (isNight) {
        return {
          modeId: "motorcycle",
          tip: "晚上市區騎車通常比步行快，也適合趕下一個點。",
        };
      }
      if (pace === "fast" || /趕|密集|效率/i.test(blob)) {
        return {
          modeId: "motorcycle",
          tip: "行程比較密集，騎車可以省下不少時間。",
        };
      }
      return {
        modeId: "motorcycle",
        tip: "台灣市區移動通常最快，適合短距離探索。",
      };
    }
  }

  if (dist > 8000) {
    const transit = modes.find((m) => m.id === "transit");
    if (transit) {
      return { modeId: "transit", tip: "距離較遠，大眾運輸比較省力。" };
    }
    const drive = modes.find((m) => m.id === "drive");
    if (drive) {
      return { modeId: "drive", tip: "距離較遠，開車或搭車會比較合適。" };
    }
  }

  return null;
}

/** Roamie 智慧推薦交通方式 */
export function recommendTransportMode(
  modes: TravelModeEstimate[],
  ctx: TransportRecommendContext,
): { modeId: TravelModeId; tip: string } {
  const rain = isRain(ctx.weather);
  const dist = ctx.distanceMeters;

  if (rain) {
    const taxi = modes.find((m) => m.id === "taxi");
    const drive = modes.find((m) => m.id === "drive");
    const pick = taxi ?? drive ?? modes[0];
    return {
      modeId: pick.id,
      tip: "今天下雨，建議直接搭車比較舒服。",
    };
  }

  if (ctx.inTaiwan) {
    const tw = recommendTaiwanMode(modes, dist, ctx);
    if (tw) return tw;
  }

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
      tip: "這段距離不遠，很適合慢慢散步過去。",
    };
  }

  if (isNight) {
    const taxi = modes.find((m) => m.id === "taxi");
    const drive = modes.find((m) => m.id === "drive");
    const pick = taxi ?? drive ?? modes[0];
    return {
      modeId: pick.id,
      tip: "晚上視線較差，搭車會比較安心。",
    };
  }

  if (dist < 2500 && (pace === "slow" || /散步|慢|步行/i.test(blob))) {
    return {
      modeId: "walk",
      tip: "路程不長，剛好可以順路看看街景。",
    };
  }

  if (dist > 8000) {
    const transit = modes.find((m) => m.id === "transit");
    if (transit) {
      return {
        modeId: "transit",
        tip: "距離稍遠，大眾運輸通常比較省力。",
      };
    }
    const drive = modes.find((m) => m.id === "drive");
    if (drive) {
      return { modeId: "drive", tip: "開車過去時間較可控，適合趕下一個點。" };
    }
  }

  if (/計程車|舒適|不想走/i.test(blob) && dist > 1500) {
    return { modeId: "taxi", tip: "依你的偏好，搭車會比較輕鬆。" };
  }

  const motorcycle = modes.find((m) => m.id === "motorcycle");
  if (motorcycle && dist >= 1000 && dist <= 8000) {
    return {
      modeId: "motorcycle",
      tip: "這段距離騎車或開車都方便，市區通常騎車較快。",
    };
  }

  const walk = modes.find((m) => m.id === "walk");
  if (walk && walk.minutes <= 18) {
    return { modeId: "walk", tip: "大約十幾分鐘路程，散步過去剛好。" };
  }

  const transit = modes.find((m) => m.id === "transit");
  if (transit && dist > 3000) {
    return { modeId: "transit", tip: "搭大眾運輸可以省體力，也方便換線。" };
  }

  return {
    modeId: "drive",
    tip: "開車過去時間較可控，適合趕下一個點。",
  };
}

export function applyRecommendedMode(
  modes: TravelModeEstimate[],
  modeId: TravelModeId,
): TravelModeEstimate[] {
  return sortModesByOrder(modes.map((m) => ({ ...m, recommended: m.id === modeId })));
}

/** 預設選取的交通方式（距離 / 天氣 / 時段 / 地區） */
export function getDefaultTransportMode(ctx: TransportRecommendContext): TravelModeId {
  const local = estimateTravelModesLocal(ctx.distanceMeters);
  return recommendTransportMode(local, ctx).modeId;
}
