import type { WeatherSummary } from "@/lib/weather.functions";

export type ReasonContext = {
  mood?: string;
  weather?: WeatherSummary | null;
  primaryType?: string | null;
  categoryLabel?: string;
  searchQuery?: string;
  /** Distance from user in meters, if known */
  distanceMeters?: number;
  hour?: number;
};

const TYPE_HINTS: Record<string, string[]> = {
  cafe: ["適合坐下來發呆一陣子", "很適合帶本書或耳機"],
  coffee: ["適合坐下來發呆一陣子", "很適合帶本書或耳機"],
  bookstore: ["適合慢慢翻書、不趕時間", "氣氛通常比較安靜"],
  park: ["適合傍晚散步", "可以讓腳步慢下來"],
  restaurant: ["適合在地小食或簡單一餐", "不用排太多行程"],
  bar: ["適合夜晚小酌或散步後來這裡", "氣氛通常比較鬆"],
  museum: ["適合雨天或想躲太陽的時候", "可以待一個下午"],
};

function normalizeTypeKey(primaryType?: string | null, label?: string): string {
  const raw = `${primaryType ?? ""} ${label ?? ""}`.toLowerCase();
  if (raw.includes("cafe") || raw.includes("coffee") || raw.includes("咖啡")) return "cafe";
  if (raw.includes("book") || raw.includes("書")) return "bookstore";
  if (raw.includes("park") || raw.includes("公園")) return "park";
  if (raw.includes("restaurant") || raw.includes("food") || raw.includes("餐") || raw.includes("小吃"))
    return "restaurant";
  if (raw.includes("bar") || raw.includes("夜")) return "bar";
  if (raw.includes("museum") || raw.includes("美術") || raw.includes("展")) return "museum";
  return "default";
}

function weatherHint(weather?: WeatherSummary | null): string | null {
  if (!weather) return null;
  const cond = weather.condition.toLowerCase();
  const precip = weather.precipProbability ?? 0;
  if (precip >= 40 || cond.includes("雨")) return "下雨天也還算適合";
  if (weather.tempC !== null && weather.tempC >= 32) return "天氣偏熱，適合有冷氣的地方";
  if (weather.tempC !== null && weather.tempC <= 14) return "外面有點冷，適合室內待久一點";
  return "今天天氣還算適合出門";
}

function moodHint(mood?: string): string | null {
  if (!mood) return null;
  if (mood.includes("放空") || mood.includes("累")) return "很適合你今天想放空一下";
  if (mood.includes("雨")) return "下雨天也想出門的話，這裡剛好";
  if (mood.includes("咖啡")) return "符合你想找咖啡的心情";
  if (mood.includes("深夜") || mood.includes("夜")) return "適合夜晚慢慢走";
  if (mood.includes("海")) return "想透透氣的話，氛圍會剛好";
  return `呼應你「${mood}」的心情`;
}

function distanceHint(meters?: number): string | null {
  if (meters === undefined) return null;
  if (meters < 800) return "距離你目前位置很近";
  if (meters < 2500) return "走路或短程交通就能到";
  if (meters < 8000) return "不算遠，適合順路過去";
  return null;
}

function timeHint(hour: number): string | null {
  if (hour >= 20) return "適合晚上散步或小坐";
  if (hour >= 17) return "傍晚來剛剛好";
  if (hour < 11) return "早上來人通常比較少";
  return null;
}

/** Fast rule-based reason for map / nearby lists */
export function buildTemplateReason(ctx: ReasonContext): string {
  const hour = ctx.hour ?? new Date().getHours();
  const typeKey = normalizeTypeKey(ctx.primaryType, ctx.categoryLabel);
  const parts: string[] = [];

  const mood = moodHint(ctx.mood);
  if (mood) parts.push(mood);

  const w = weatherHint(ctx.weather);
  if (w) parts.push(w);

  const d = distanceHint(ctx.distanceMeters);
  if (d) parts.push(d);

  const t = timeHint(hour);
  if (t) parts.push(t);

  const typeLines = TYPE_HINTS[typeKey] ?? ["適合慢步調繞一圈", "值得花點時間停留"];
  parts.push(typeLines[hour % typeLines.length]);

  const unique = [...new Set(parts.filter(Boolean))];
  return unique.slice(0, 2).join("，") + "。";
}
