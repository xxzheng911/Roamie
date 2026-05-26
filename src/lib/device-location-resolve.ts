import { isDefaultTaipeiCenter, normalizeDeviceLocation, TAIPEI_CENTER } from "@/lib/geo";
import { isTaiwanCoordinates } from "@/lib/geo-region";

/** Xcode / iOS Simulator 內建美國西岸預設點 */
export const IOS_SIMULATOR_PRESETS = [
  { lat: 37.3346, lng: -122.009 },
  { lat: 37.7749, lng: -122.4194 },
  { lat: 37.785834, lng: -122.406417 },
  { lat: 37.323, lng: -122.032 },
] as const;

export const SIMULATOR_PRESET_KM = 14;

/** 開發版 Simulator 預設改為台灣時使用（非 TAIPEI_CENTER） */
export const DEV_SIMULATOR_TW_DEFAULT = { lat: 25.033, lng: 121.5654 } as const;

export type ResolvedGpsKind = "gps" | "dev-simulator-substitute";

export type ResolvedGps = {
  lat: number;
  lng: number;
  kind: ResolvedGpsKind;
  /** 原始 GPS 是否為 Simulator 美國預設點 */
  simulatorPreset: boolean;
  substituteReason?: string;
};

export type ResolveGpsInput = {
  lat: number;
  lng: number;
  /** 正式版 (vite build) 必須為 false */
  isDevBuild: boolean;
  isNativeShell: boolean;
  allowSimulatorGps: boolean;
  devOverride: { lat: number; lng: number } | null;
  lastGood: { lat: number; lng: number } | null;
};

export type FallbackPick = {
  lat: number;
  lng: number;
  usedDefaultTaipei: boolean;
};

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isIosSimulatorPresetLocation(lat: number, lng: number): boolean {
  return IOS_SIMULATOR_PRESETS.some(
    (p) => haversineKm(lat, lng, p.lat, p.lng) <= SIMULATOR_PRESET_KM,
  );
}

/**
 * 將 GPS 座標解析為 App 使用的座標。
 * 正式版：永遠回傳真實 GPS，不做地區替換。
 */
export function resolveGpsCoordinates(input: ResolveGpsInput): ResolvedGps | null {
  const normalized = normalizeDeviceLocation(input.lat, input.lng);
  if (!normalized) return null;

  const simulatorPreset = isIosSimulatorPresetLocation(normalized.lat, normalized.lng);

  const substitute = resolveDevSimulatorSubstitute({
    isDevBuild: input.isDevBuild,
    isNativeShell: input.isNativeShell,
    allowSimulatorGps: input.allowSimulatorGps,
    simulatorPreset,
    devOverride: input.devOverride,
    lastGood: input.lastGood,
  });

  if (substitute) {
    return {
      lat: substitute.lat,
      lng: substitute.lng,
      kind: "dev-simulator-substitute",
      simulatorPreset: true,
      substituteReason: substitute.reason,
    };
  }

  return {
    lat: normalized.lat,
    lng: normalized.lng,
    kind: "gps",
    simulatorPreset,
  };
}

function resolveDevSimulatorSubstitute(ctx: {
  isDevBuild: boolean;
  isNativeShell: boolean;
  allowSimulatorGps: boolean;
  simulatorPreset: boolean;
  devOverride: { lat: number; lng: number } | null;
  lastGood: { lat: number; lng: number } | null;
}): { lat: number; lng: number; reason: string } | null {
  if (!ctx.isDevBuild || !ctx.isNativeShell || ctx.allowSimulatorGps || !ctx.simulatorPreset) {
    return null;
  }

  if (ctx.devOverride) return { ...ctx.devOverride, reason: "env" };

  if (
    ctx.lastGood &&
    isTaiwanCoordinates(ctx.lastGood.lat, ctx.lastGood.lng) &&
    !isDefaultTaipeiCenter(ctx.lastGood.lat, ctx.lastGood.lng)
  ) {
    return { ...ctx.lastGood, reason: "last-good" };
  }

  return {
    lat: DEV_SIMULATOR_TW_DEFAULT.lat,
    lng: DEV_SIMULATOR_TW_DEFAULT.lng,
    reason: "dev-default",
  };
}

/** GPS 完全失敗時：上次有效座標 → 最近搜尋城市 → 台北預設 */
export function pickFallbackCoordinates(
  lastGood: { lat: number; lng: number } | null,
  lastSearch?: { lat: number; lng: number } | null,
): FallbackPick {
  if (lastGood && !isDefaultTaipeiCenter(lastGood.lat, lastGood.lng)) {
    return { lat: lastGood.lat, lng: lastGood.lng, usedDefaultTaipei: false };
  }
  if (lastSearch && !isDefaultTaipeiCenter(lastSearch.lat, lastSearch.lng)) {
    return { lat: lastSearch.lat, lng: lastSearch.lng, usedDefaultTaipei: false };
  }
  return {
    lat: TAIPEI_CENTER.lat,
    lng: TAIPEI_CENTER.lng,
    usedDefaultTaipei: true,
  };
}

/** 是否應記住為「上次有效座標」（供 session 快取） */
export function shouldRememberCoords(lat: number, lng: number): boolean {
  const normalized = normalizeDeviceLocation(lat, lng);
  if (!normalized) return false;
  if (isDefaultTaipeiCenter(normalized.lat, normalized.lng)) return false;
  if (isIosSimulatorPresetLocation(normalized.lat, normalized.lng)) return false;
  return true;
}
