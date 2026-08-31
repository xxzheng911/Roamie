import type { PlaceIdentity } from "@/lib/place-identity";

export const INTEREST_IDENTITY_MAPPINGS: Record<string, PlaceIdentity[]> = {
  coffee: ["cafe", "bakery", "dessert"],
  food: ["restaurant", "food_stall", "breakfast_shop", "night_market", "cafe", "bakery", "dessert"],
  nature: ["park", "tourist_attraction"],
  culture: ["museum", "bookstore", "tourist_attraction", "district"],
  shopping: ["shopping_mall", "department_store", "district", "night_market"],
};

export const PACE_IDENTITY_MAPPINGS: Record<"slow" | "active", PlaceIdentity[]> = {
  slow: ["cafe", "bakery", "bookstore", "park", "museum", "tourist_attraction"],
  active: ["tourist_attraction", "district", "museum", "shopping_mall", "night_market"],
};

export const VIBE_IDENTITY_MAPPINGS: Record<"quiet" | "lively", PlaceIdentity[]> = {
  quiet: ["bookstore", "cafe", "museum", "park", "bakery"],
  lively: ["night_market", "district", "food_stall", "bar"],
};

export const TRAVEL_STYLE_IDENTITY_MAPPINGS = INTEREST_IDENTITY_MAPPINGS;

export const BUDGET_IDENTITY_MAPPINGS: Record<string, PlaceIdentity[]> = {
  budget: ["food_stall", "breakfast_shop", "night_market", "park"],
  quality: ["cafe", "restaurant", "museum", "bakery"],
  luxury: ["restaurant", "bar", "department_store"],
};

export const CROWD_RISK_IDENTITIES: PlaceIdentity[] = [
  "shopping_mall", "department_store", "tourist_attraction", "night_market", "district",
];

export function normalizePreferenceTag(value: string): keyof typeof INTEREST_IDENTITY_MAPPINGS | null {
  const text = value.toLowerCase();
  if (/咖啡|甜點|下午茶|cafe|coffee|dessert/.test(text)) return "coffee";
  if (/美食|餐|小吃|food|restaurant/.test(text)) return "food";
  if (/自然|公園|戶外|散步|park|nature/.test(text)) return "nature";
  if (/文化|藝術|展覽|博物|書|歷史|culture|museum/.test(text)) return "culture";
  if (/逛|購物|shop/.test(text)) return "shopping";
  return null;
}

export function identityMatchesTags(
  values: readonly string[] | undefined,
  identity: PlaceIdentity,
): { matched: boolean; mappings: string[] } {
  const mappings: string[] = [];
  for (const value of values ?? []) {
    const tag = normalizePreferenceTag(value);
    if (tag && INTEREST_IDENTITY_MAPPINGS[tag].includes(identity)) mappings.push(`interest:${tag}`);
  }
  return { matched: mappings.length > 0, mappings };
}
