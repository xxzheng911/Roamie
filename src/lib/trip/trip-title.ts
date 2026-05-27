import type { RoamiePayloadV2 } from "@/lib/ai/types";

export type TripTitleInput = {
  destination?: string | null;
  moodTag?: string | null;
  mood?: string | null;
  category?: string | null;
  placeName?: string | null;
};

const GENERIC_TITLES = new Set([
  "你的慢旅行",
  "行程草稿",
  "我的行程",
  "未命名行程",
  "",
]);

function extractAreaLabel(destination: string): string {
  const trimmed = destination.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
  return parts[0] ?? trimmed;
}

function detectCategory(input: TripTitleInput): string | null {
  const hay = [
    input.category ?? "",
    input.placeName ?? "",
    input.moodTag ?? "",
    input.mood ?? "",
    input.destination ?? "",
  ]
    .join(" ")
    .toLowerCase();

  if (/(咖啡|cafe|coffee)/.test(hay)) return "咖啡";
  if (/(餐廳|美食|food|吃)/.test(hay)) return "美食";
  if (/(老街|market|市集)/.test(hay)) return "老街";
  if (/(公園|park|散步|walking)/.test(hay)) return "散步";
  if (/(夜景|night)/.test(hay)) return "夜景";
  if (/(森林|forest|山|mountain)/.test(hay)) return "森林";
  if (/(海|beach|沙灘)/.test(hay)) return "海邊";
  return null;
}

function detectMoodSuffix(mood: string): string | null {
  const m = mood.trim();
  if (!m) return null;
  if (/散步|走走|walking/i.test(m)) return "散步提案";
  if (/放空|relax|chill/i.test(m)) return "放空旅程";
  if (/漫遊|一日|day trip/i.test(m)) return "一日漫遊";
  if (/小旅行|輕旅行/i.test(m)) return "小旅行";
  if (/提案|plan/i.test(m)) return "提案";
  return null;
}

/** 依 destination / category / mood 自動生成預設行程名稱 */
export function generateTripTitle(input: TripTitleInput): string {
  const dest = extractAreaLabel(input.destination ?? input.placeName ?? "");
  const mood = (input.moodTag ?? input.mood ?? "").trim();
  const category = input.category?.trim() || detectCategory(input);
  const moodSuffix = detectMoodSuffix(mood);

  if (category === "森林" && /放空|relax|chill/i.test(mood)) {
    return "森林放空旅程";
  }

  if (dest && category === "咖啡") {
    const city = dest.match(/^[\u4e00-\u9fff]{2,4}/)?.[0] ?? dest;
    return `${city}咖啡散步提案`;
  }

  if (dest && category === "老街") {
    const city = dest.match(/^[\u4e00-\u9fff]{2,4}/)?.[0] ?? dest;
    return `${city}老街散步提案`;
  }

  if (dest && category === "夜景") {
    return `${dest}夜景小旅行`;
  }

  if (dest && moodSuffix === "一日漫遊") {
    return `${dest}一日小旅行`;
  }

  const placeName = input.placeName?.trim();
  if (placeName) {
    if (dest && !placeName.includes(dest)) {
      return `${placeName}的${dest}小旅行`;
    }
    return `${placeName}的小旅行`;
  }

  if (dest && moodSuffix) {
    return `${dest}的${moodSuffix}`;
  }

  if (dest) {
    return `${dest}的小旅行`;
  }

  if (category === "森林") return "森林放空旅程";
  if (category === "海邊") return "海邊小旅行";
  if (mood) return `${mood}小旅行`;

  return "我的慢旅行";
}

export function isGenericTripTitle(title: string | null | undefined): boolean {
  const t = title?.trim() ?? "";
  return GENERIC_TITLES.has(t) || t === "行程草稿";
}

export function resolveTripTitle(payload: RoamiePayloadV2): string {
  const firstStop = payload.itinerary?.[0];
  if (!isGenericTripTitle(payload.title)) {
    return payload.title.trim();
  }
  return generateTripTitle({
    destination: payload.destination ?? payload.destinationLocation?.displayLabel,
    moodTag: payload.moodTag,
    category: firstStop?.placeType,
    placeName: firstStop?.placeName,
  });
}

export function tripTitleInputFromPayload(payload: RoamiePayloadV2): TripTitleInput {
  const firstStop = payload.itinerary?.[0];
  return {
    destination: payload.destination ?? payload.destinationLocation?.displayLabel,
    moodTag: payload.moodTag,
    category: firstStop?.placeType,
    placeName: firstStop?.placeName,
  };
}
