/** 導購 CTA 意圖（依地點類型決定按鈕文案） */
export type AffiliatePlaceIntent = "tickets" | "experiences" | "accommodation";

export type AffiliatePlaceTypeInput = {
  placeName?: string | null;
  /** AI `type`、行程 `placeType`、收藏 `category`、推薦分類 id 等 */
  typeLabel?: string | null;
  primaryType?: string | null;
  types?: string[] | null;
};

const INTENT_LABEL: Record<AffiliatePlaceIntent, string> = {
  tickets: "查看門票",
  experiences: "查看相關體驗",
  accommodation: "查看住宿方案",
};

const ACCOMMODATION_TYPES = new Set([
  "lodging",
  "hotel",
  "motel",
  "hostel",
  "resort_hotel",
  "extended_stay_hotel",
  "bed_and_breakfast",
  "guest_house",
]);

const TICKET_TYPES = new Set([
  "tourist_attraction",
  "museum",
  "art_gallery",
  "amusement_park",
  "aquarium",
  "zoo",
  "historical_landmark",
  "monument",
  "cultural_center",
  "performing_arts_theater",
  "stadium",
  "planetarium",
  "observation_deck",
]);

const EXPERIENCE_TYPES = new Set(["travel_agency", "tour_agency"]);

const ACCOMMODATION_RE =
  /住宿|飯店|旅館|民宿|宾馆|旅店|度假村|\bhotel\b|\bhostel\b|\bmotel\b|\blodging\b|\binn\b|\bresort\b/i;

const EXPERIENCE_RE =
  /一日遊|半日遊|多日遊|包車|私人導覽|導覽團|導覽|體驗活動|體驗課|體驗|工作坊|和服體驗|料理教室|浮潛|潛水|潜水|獨木舟|露營|溫泉券|票券體驗|city\s*tour|day\s*tour|guided\s*tour|experience\s*tour|workshop/i;

const TICKET_RE =
  /景點|觀光|名勝|古蹟|遺跡|世界遺產|樂園|主題樂園|迪士尼|環球|遊樂|摩天輪|水族館|動物園|博物館|美術館|紀念館|展覽館|展望台|觀景台|觀景|天空塔|塔景|神社|寺廟|廟宇|燈塔|城堡|palace|temple|shrine|museum|gallery|observatory|observation\s*deck|theme\s*park|amusement|attraction|landmark/i;

const TICKET_TYPE_LABEL_RE =
  /景點|樂園|展望台|博物館|美術館|觀光|名勝|古蹟|紀念|展覽|水族|動物園/i;

const EXPERIENCE_TYPE_LABEL_RE = /一日遊|導覽|體驗活動|體驗|行程|包車|tour/i;

const ACCOMMODATION_TYPE_LABEL_RE = /飯店|住宿|旅館|民宿|hotel|lodging/i;

function collectHaystack(input: AffiliatePlaceTypeInput): string {
  return [
    input.placeName ?? "",
    input.typeLabel ?? "",
    input.primaryType ?? "",
    ...(input.types ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

function hasTypeToken(types: string[] | null | undefined, allowed: Set<string>): boolean {
  if (!types?.length) return false;
  return types.some((t) => allowed.has(t.toLowerCase()));
}

function matchesTypeLabel(typeLabel: string, re: RegExp): boolean {
  const t = typeLabel.trim();
  return Boolean(t) && re.test(t);
}

export function resolveAffiliatePlaceIntent(input: AffiliatePlaceTypeInput): AffiliatePlaceIntent {
  const hay = collectHaystack(input);
  const typeLabel = (input.typeLabel ?? "").trim();
  const types = input.types ?? [];

  if (
    hasTypeToken(types, ACCOMMODATION_TYPES) ||
    ACCOMMODATION_RE.test(hay) ||
    matchesTypeLabel(typeLabel, ACCOMMODATION_TYPE_LABEL_RE)
  ) {
    return "accommodation";
  }

  if (
    hasTypeToken(types, EXPERIENCE_TYPES) ||
    EXPERIENCE_RE.test(hay) ||
    matchesTypeLabel(typeLabel, EXPERIENCE_TYPE_LABEL_RE)
  ) {
    return "experiences";
  }

  if (
    hasTypeToken(types, TICKET_TYPES) ||
    TICKET_RE.test(hay) ||
    matchesTypeLabel(typeLabel, TICKET_TYPE_LABEL_RE) ||
    (input.primaryType && TICKET_TYPES.has(input.primaryType.toLowerCase()))
  ) {
    return "tickets";
  }

  return "experiences";
}

export function affiliateIntentLabel(intent: AffiliatePlaceIntent): string {
  return INTENT_LABEL[intent];
}

export function affiliateIntentFromPlaceInput(input: AffiliatePlaceTypeInput): {
  intent: AffiliatePlaceIntent;
  label: string;
} {
  const intent = resolveAffiliatePlaceIntent(input);
  return { intent, label: affiliateIntentLabel(intent) };
}
