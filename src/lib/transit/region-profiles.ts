/** 城市／國家交通特性（規則引擎用） */

export type RegionProfile = {
  id: string;
  label: string;
  /** 地鐵／捷運複雜度 */
  metroComplexity: "low" | "medium" | "high";
  /** 深夜後更建議計程車 */
  lateNightTaxiAfterHour: number;
  walkFriendly: boolean;
  trafficCongestion: "low" | "medium" | "high";
  notes: string[];
};

const PROFILES: RegionProfile[] = [
  {
    id: "tokyo",
    label: "東京",
    metroComplexity: "high",
    lateNightTaxiAfterHour: 23,
    walkFriendly: true,
    trafficCongestion: "medium",
    notes: ["地鐵轉乘複雜、出口多", "初次造訪大站建議預留轉乘時間"],
  },
  {
    id: "osaka",
    label: "大阪",
    metroComplexity: "medium",
    lateNightTaxiAfterHour: 23,
    walkFriendly: true,
    trafficCongestion: "medium",
    notes: ["地下街連通多，注意標示"],
  },
  {
    id: "kyoto",
    label: "京都",
    metroComplexity: "medium",
    lateNightTaxiAfterHour: 22,
    walkFriendly: true,
    trafficCongestion: "high",
    notes: ["公車易塞車", "核心景點間步行體驗佳"],
  },
  {
    id: "seoul",
    label: "首爾",
    metroComplexity: "high",
    lateNightTaxiAfterHour: 24,
    walkFriendly: true,
    trafficCongestion: "high",
    notes: ["地鐵出口多、轉乘動線長", "尖峰地鐵很擠"],
  },
  {
    id: "taipei",
    label: "台北",
    metroComplexity: "medium",
    lateNightTaxiAfterHour: 23,
    walkFriendly: true,
    trafficCongestion: "medium",
    notes: ["捷運覆蓋佳", "機車多需注意過馬路"],
  },
  {
    id: "bangkok",
    label: "曼谷",
    metroComplexity: "medium",
    lateNightTaxiAfterHour: 22,
    walkFriendly: false,
    trafficCongestion: "high",
    notes: ["尖峰嚴重壅塞", "短途也建議評估 Grab"],
  },
  {
    id: "default",
    label: "一般城市",
    metroComplexity: "medium",
    lateNightTaxiAfterHour: 23,
    walkFriendly: true,
    trafficCongestion: "medium",
    notes: [],
  },
];

const MATCHERS: Array<{ id: string; pattern: RegExp }> = [
  { id: "tokyo", pattern: /東京|tokyo|渋谷|新宿|池袋/i },
  { id: "osaka", pattern: /大阪|osaka|難波|道頓堀/i },
  { id: "kyoto", pattern: /京都|kyoto/i },
  { id: "seoul", pattern: /首爾|首尔|seoul|弘大|明洞/i },
  { id: "taipei", pattern: /台北|臺北|taipei|大安|信義/i },
  { id: "bangkok", pattern: /曼谷|bangkok/i },
];

export function resolveRegionProfile(destination?: string): RegionProfile {
  const text = destination ?? "";
  for (const m of MATCHERS) {
    if (m.pattern.test(text)) {
      return PROFILES.find((p) => p.id === m.id) ?? PROFILES[PROFILES.length - 1]!;
    }
  }
  return PROFILES[PROFILES.length - 1]!;
}

export function isJapanOrKorea(destination?: string): boolean {
  return /日本|东京|東京|大阪|京都|首爾|韩国|韓國|japan|korea|jp|kr/i.test(
    destination ?? "",
  );
}
