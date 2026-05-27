import type { LegDurationEstimate } from "@/lib/routes/types";
import {
  isJapanOrKorea,
  resolveRegionProfile,
  type RegionProfile,
} from "@/lib/transit/region-profiles";
import {
  buildLegKey,
  type TransitComplexity,
  type TransitLegAdvice,
  type TransitMode,
  type TransitPreferences,
  type TransitWeatherHint,
} from "@/lib/transit/types";

const MODE_LABEL: Record<TransitMode, string> = {
  walk: "步行",
  subway: "地鐵",
  bus: "公車",
  transit: "大眾運輸",
  taxi: "計程車",
  uber: "Uber",
  hsr: "高鐵",
  train: "火車",
  drive: "開車",
  scooter: "機車",
};

const MODE_ICON_KEY: Record<TransitMode, string> = {
  walk: "walk",
  subway: "subway",
  bus: "bus",
  transit: "subway",
  taxi: "taxi",
  uber: "uber",
  hsr: "hsr",
  train: "train",
  drive: "drive",
  scooter: "scooter",
};

export function getTransitModeLabel(mode: TransitMode): string {
  return MODE_LABEL[mode];
}

export function getTransitModeIconKey(mode: TransitMode): string {
  return MODE_ICON_KEY[mode];
}

function parseHour(time?: string): number | null {
  if (!time) return null;
  const m = time.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10);
}

function prefersTaxi(prefs: TransitPreferences): boolean {
  const t =
    `${prefs.transportation ?? ""} ${prefs.pace ?? ""} ${prefs.companionship ?? ""}`.toLowerCase();
  return /計程|taxi|uber|輕鬆|長輩|爸媽|媽媽|爸爸|小孩|親子|行李|趕|累/.test(t);
}

function prefersWalk(prefs: TransitPreferences): boolean {
  const t = `${prefs.vibe ?? ""} ${prefs.pace ?? ""} ${prefs.transportation ?? ""}`.toLowerCase();
  return /慢|散步|步行|走路|慢旅|i人|發呆/.test(t);
}

function isRushHour(hour: number | null): boolean {
  if (hour == null) return false;
  return (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19);
}

function buildHeadline(mode: TransitMode, minutes: number): string {
  const label = MODE_LABEL[mode];
  if (mode === "walk") return `適合散步（約 ${minutes} 分鐘）`;
  if (mode === "uber" || mode === "taxi") return `建議搭 ${label}（約 ${minutes} 分鐘）`;
  if (mode === "subway" || mode === "transit") return `地鐵最方便（約 ${minutes} 分鐘）`;
  if (mode === "bus") return `公車可行（約 ${minutes} 分鐘）`;
  if (mode === "hsr" || mode === "train") return `建議搭 ${label}（約 ${minutes} 分鐘）`;
  return `建議${label}（約 ${minutes} 分鐘）`;
}

function buildReason(
  mode: TransitMode,
  estimates: LegDurationEstimate,
  region: RegionProfile,
  prefs: TransitPreferences,
  weather: TransitWeatherHint,
  hour: number | null,
  destination?: string,
): string {
  const dist = estimates.distanceMeters;
  const walk = estimates.walk ?? Math.round(dist / 80);
  const drive = estimates.drive ?? estimates.transit;

  if (mode === "walk") {
    if (dist < 500) return "距離很近，走過去剛好，不用搭車。";
    if (region.walkFriendly) return "這段路很適合散步，沿路可以慢慢看街景。";
    return "步行時間不長，當作行程間的小移動剛好。";
  }

  if (mode === "uber" || mode === "taxi") {
    if (isJapanOrKorea(destination) && region.metroComplexity === "high") {
      return "這段轉乘較複雜，第一次去搭車會更輕鬆。";
    }
    if (hour != null && hour >= region.lateNightTaxiAfterHour) {
      return "時間偏晚，大眾運輸選擇較少，搭車比較省心。";
    }
    if (weather.isRainy) return "下雨天移動，搭車比較舒服。";
    if (weather.isHot) return "天氣偏熱，這段搭車會比較輕鬆。";
    if (weather.isNight) return "夜間移動，搭車或大眾運輸較安心。";
    if (prefersTaxi(prefs)) return "依你的旅遊節奏，這段搭車會比較省力。";
    if (drive != null && walk != null && drive + 8 < walk) {
      return `開車約 ${drive} 分鐘，比步行省不少時間。`;
    }
    return "這段搭車體驗較輕鬆，不用拖著行李轉乘。";
  }

  if (mode === "subway" || mode === "transit" || mode === "bus") {
    if (estimates.transit != null && drive != null && estimates.transit <= drive + 5) {
      return "大眾運輸直達或轉乘合理，不必開車。";
    }
    if (region.metroComplexity === "high") {
      return "地鐵能避開路面塞車，但轉乘動線要預留時間。";
    }
    return "大眾運輸性價比高，適合這段距離。";
  }

  if (mode === "hsr" || mode === "train") {
    return "距離較遠，建議用鐵路移動，比開車省心。";
  }

  if (mode === "scooter") {
    return "這段距離騎機車很快，注意當地交通規則。";
  }

  return "依距離與路況，這段用這種方式較順。";
}

function pickMode(
  estimates: LegDurationEstimate,
  region: RegionProfile,
  prefs: TransitPreferences,
  weather: TransitWeatherHint,
  hour: number | null,
  destination?: string,
): { mode: TransitMode; complexity: TransitComplexity; minutes: number } {
  const dist = estimates.distanceMeters;
  const walkMin = estimates.walk ?? Math.max(1, Math.round(dist / 75));
  const driveMin = estimates.drive ?? Math.max(walkMin, Math.round(dist / 500));
  const transitMin = estimates.transit ?? driveMin;

  if (dist >= 25_000) {
    if (/台灣|台湾|taiwan/i.test(destination ?? "")) {
      return { mode: "hsr", complexity: "low", minutes: Math.min(driveMin, 120) };
    }
    if (isJapanOrKorea(destination ?? "")) {
      return { mode: "train", complexity: "low", minutes: Math.min(transitMin, driveMin, 90) };
    }
    return { mode: "drive", complexity: "medium", minutes: driveMin };
  }

  if (weather.isHot && dist > 500) {
    return { mode: "taxi", complexity: "low", minutes: driveMin };
  }

  if (weather.isNight && dist > 900 && walkMin > 12) {
    return {
      mode: region.id === "bangkok" ? "uber" : "taxi",
      complexity: "low",
      minutes: driveMin,
    };
  }

  if (dist <= 550 && walkMin <= 8 && !weather.isRainy && !(weather.isHot ?? false)) {
    return { mode: "walk", complexity: "low", minutes: walkMin };
  }

  if (
    dist <= 1200 &&
    walkMin <= 15 &&
    prefersWalk(prefs) &&
    !weather.isRainy &&
    !(weather.isHot ?? false) &&
    !isRushHour(hour)
  ) {
    return { mode: "walk", complexity: "low", minutes: walkMin };
  }

  const late = hour != null && hour >= region.lateNightTaxiAfterHour;
  const complexMetro = region.metroComplexity === "high" && dist > 900;

  if (late || (complexMetro && prefersTaxi(prefs))) {
    return {
      mode: region.id === "bangkok" ? "uber" : "uber",
      complexity: "medium",
      minutes: driveMin,
    };
  }

  if (weather.isRainy && dist > 700) {
    return { mode: "taxi", complexity: "low", minutes: driveMin };
  }

  if (prefersTaxi(prefs) && driveMin + 5 < walkMin) {
    return { mode: "uber", complexity: "medium", minutes: driveMin };
  }

  if (/機車|scooter/i.test(prefs.transportation ?? "") && /台|taipei/i.test(destination ?? "")) {
    if (dist > 600 && dist < 8000) {
      return { mode: "scooter", complexity: "low", minutes: Math.round(driveMin * 0.85) };
    }
  }

  if (transitMin <= driveMin + 8 && dist < 12_000) {
    const complexity: TransitComplexity =
      region.metroComplexity === "high" && dist > 2000 ? "high" : "medium";
    return {
      mode: region.metroComplexity === "high" ? "subway" : "transit",
      complexity,
      minutes: transitMin,
    };
  }

  if (driveMin < walkMin - 5) {
    return { mode: "drive", complexity: "low", minutes: driveMin };
  }

  return { mode: "walk", complexity: "low", minutes: walkMin };
}

export function recommendLegFromEstimates(args: {
  fromName: string;
  toName: string;
  estimates: LegDurationEstimate;
  destination?: string;
  preferences?: TransitPreferences;
  weather?: TransitWeatherHint;
  time?: string;
}): TransitLegAdvice {
  const region = resolveRegionProfile(args.destination);
  const prefs = args.preferences ?? {};
  const weather = args.weather ?? {};
  const hour = parseHour(args.time);

  const { mode, complexity, minutes } = pickMode(
    args.estimates,
    region,
    prefs,
    weather,
    hour,
    args.destination,
  );

  const alternatives: TransitLegAdvice["alternatives"] = [];
  const walk = args.estimates.walk;
  const drive = args.estimates.drive ?? args.estimates.transit;
  if (mode !== "walk" && walk != null) {
    alternatives.push({ mode: "walk", label: MODE_LABEL.walk, durationMinutes: walk });
  }
  if (mode !== "uber" && mode !== "taxi" && drive != null) {
    alternatives.push({
      mode: "uber",
      label: "Uber",
      durationMinutes: drive,
    });
  }
  if (args.estimates.transit != null && mode !== "subway" && mode !== "transit") {
    alternatives.push({
      mode: "subway",
      label: MODE_LABEL.subway,
      durationMinutes: args.estimates.transit,
    });
  }

  const reason = buildReason(mode, args.estimates, region, prefs, weather, hour, args.destination);

  return {
    legKey: buildLegKey(args.fromName, args.toName),
    fromName: args.fromName,
    toName: args.toName,
    recommendedMode: mode,
    headline: buildHeadline(mode, minutes),
    durationMinutes: minutes,
    distanceMeters: args.estimates.distanceMeters,
    reason,
    complexity,
    estimates: {
      walk: args.estimates.walk,
      drive: args.estimates.drive,
      transit: args.estimates.transit,
    },
    alternatives: alternatives.slice(0, 3),
    source: "rules",
  };
}
