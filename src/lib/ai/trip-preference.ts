export type TripInterest =
  | "attractions"
  | "shopping"
  | "food"
  | "night_market"
  | "culture"
  | "massage";

const INTEREST_KEYWORDS: Record<TripInterest, string[]> = {
  attractions: ["景點", "必去", "地標", "文化景點", "古蹟", "寺廟", "寺社"],
  shopping: ["購物", "shopping", "商圈", "百貨", "商場", "市集"],
  food: ["美食", "吃", "餐廳", "小吃", "料理"],
  night_market: ["夜市", "夜晚", "夜生活"],
  culture: ["文化", "博物館", "人文"],
  massage: ["按摩", "spa"],
};

const INTEREST_PRIORITY: TripInterest[] = [
  "attractions",
  "culture",
  "shopping",
  "food",
  "night_market",
  "massage",
];

const INTEREST_LABELS: Record<TripInterest, string> = {
  attractions: "景點",
  shopping: "購物",
  food: "美食",
  night_market: "夜市",
  culture: "文化",
  massage: "按摩",
};

function normalizePreferenceText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, "")
    .replace(/\+/g, "＋")
    .toLowerCase();
}

function textHasInterest(text: string, interest: TripInterest): boolean {
  const normalized = normalizePreferenceText(text);
  return INTEREST_KEYWORDS[interest].some((keyword) =>
    normalized.includes(normalizePreferenceText(keyword)),
  );
}

export function parseTripPreferences(text: string): TripInterest[] {
  const t = text.trim();
  if (!t) return [];

  const segments = t
    .split(/[跟和及、,，＋+／/]/)
    .map((part) => part.trim())
    .filter(Boolean);

  const candidates = segments.length > 1 ? segments : [t];
  const found = new Set<TripInterest>();

  for (const segment of candidates) {
    for (const interest of INTEREST_PRIORITY) {
      if (textHasInterest(segment, interest)) {
        found.add(interest);
      }
    }
  }

  if (found.has("culture") && !found.has("attractions")) {
    found.add("attractions");
  }

  if (found.has("attractions") && found.has("culture")) {
    found.delete("culture");
  }

  return INTEREST_PRIORITY.filter((interest) => found.has(interest));
}

export function formatTripInterestLabel(interest: TripInterest): string {
  return INTEREST_LABELS[interest];
}

export function formatTripInterestMix(interests: TripInterest[]): string {
  return interests.map(formatTripInterestLabel).join("＋");
}

export function tripPreferencesToContextInterests(interests: TripInterest[]): string[] {
  return interests.map(formatTripInterestLabel);
}
