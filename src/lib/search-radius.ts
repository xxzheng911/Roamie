/** 依交通／探索模式決定 nearby 搜尋半徑（公尺） */

export type ExploreTransportMode = "walk" | "relax" | "drive" | "default";

export function normalizeTransportMode(input?: string | null): ExploreTransportMode {
  const t = (input ?? "").trim();
  if (!t) return "default";
  if (/(步行|走路|on foot|walk)/i.test(t)) return "walk";
  if (/(開車|自駕|drive|car)/i.test(t)) return "drive";
  if (/(大眾|捷運|公車|地鐵|metro|transit|ubahn)/i.test(t)) return "relax";
  if (/(單車|bike|bicycle)/i.test(t)) return "relax";
  if (/(放鬆|慢慢|隨意|explore|relaxed)/i.test(t)) return "relax";
  return "default";
}

export function searchRadiusMeters(mode: ExploreTransportMode = "default"): number {
  switch (mode) {
    case "walk":
      return 2_000;
    case "relax":
      return 5_000;
    case "drive":
      return 15_000;
    default:
      return 5_000;
  }
}

export function searchRadiusLabel(mode: ExploreTransportMode): string {
  switch (mode) {
    case "walk":
      return "步行 1–3km";
    case "relax":
      return "放鬆探索 3–8km";
    case "drive":
      return "開車擴大範圍";
    default:
      return "附近推薦";
  }
}

/** 正式版不使用 mock 地點；開發版可保留 demo fallback */
export function allowDemoPlaceFallback(): boolean {
  return import.meta.env.DEV && !import.meta.env.PROD;
}
