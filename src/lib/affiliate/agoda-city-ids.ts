import { normalizeTripComDestination } from "@/lib/affiliate/trip-com-hotel-url";

/** Agoda /search?city= 專用 cityId（與 Trip.com cityId 不同） */
const AGODA_CITY_BY_KEY: Record<string, string> = {
  東京: "5085",
  东京: "5085",
  tokyo: "5085",
  大阪: "9590",
  osaka: "9590",
  京都: "9590",
  kyoto: "9590",
  首爾: "14690",
  首尔: "14690",
  seoul: "14690",
  釜山: "17172",
  busan: "17172",
  台北: "4951",
  臺北: "4951",
  taipei: "4951",
  台中: "120841",
  臺中: "120841",
  taichung: "120841",
  高雄: "756",
  kaohsiung: "756",
  香港: "16808",
  "hong kong": "16808",
  曼谷: "9395",
  bangkok: "9395",
  新加坡: "4064",
  singapore: "4064",
  上海: "3145",
  shanghai: "3145",
  北京: "1569",
  beijing: "1569",
  沖繩: "717899",
  冲绳: "717899",
  okinawa: "717899",
  福岡: "16527",
  福冈: "16527",
  fukuoka: "16527",
  札幌: "16525",
  sapporo: "16525",
  名古屋: "16526",
  nagoya: "16526",
  濟州: "16901",
  济州: "16901",
  jeju: "16901",
  峇里島: "17193",
  巴厘岛: "17193",
  bali: "17193",
  吉隆坡: "4580",
  "kuala lumpur": "4580",
};

function splitDestinationParts(destination: string): string[] {
  return destination
    .split(/[・·/|,，、\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** 解析 Agoda cityId；無 mapping 時回傳 undefined */
export function resolveAgodaCityId(destination: string): string | undefined {
  const trimmed = destination.trim();
  if (!trimmed) return undefined;

  const parts = splitDestinationParts(trimmed);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const key = parts[i]!;
    const hit = AGODA_CITY_BY_KEY[key] ?? AGODA_CITY_BY_KEY[key.toLowerCase()];
    if (hit) return hit;
  }

  const whole = AGODA_CITY_BY_KEY[trimmed] ?? AGODA_CITY_BY_KEY[trimmed.toLowerCase()];
  if (whole) return whole;

  const mapped = normalizeTripComDestination(trimmed);
  const keyword = mapped.zhKeyword ?? mapped.keyword;
  if (keyword) {
    return AGODA_CITY_BY_KEY[keyword] ?? AGODA_CITY_BY_KEY[keyword.toLowerCase()];
  }

  return undefined;
}
