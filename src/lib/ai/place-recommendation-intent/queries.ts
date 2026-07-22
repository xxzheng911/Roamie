/**
 * Multilingual Place Recommendation Query Builder.
 * Limits API fan-out: max ~8 unique queries per request.
 */
import type { SearchAttempt } from "@/lib/ai/chat-place-recommendation";
import {
  attractionTypeSearchTokens,
  cuisineSearchTokens,
  shoppingTypeSearchTokens,
} from "@/lib/ai/recommendation-refinement/parser";
import type { PlaceRecommendationQueryBuildInput } from "@/lib/ai/place-recommendation-intent/types";

const CITY_EN: Record<string, string> = {
  札幌: "Sapporo",
  小樽: "Otaru",
  函館: "Hakodate",
  旭川: "Asahikawa",
  東京: "Tokyo",
  大阪: "Osaka",
  京都: "Kyoto",
  福岡: "Fukuoka",
  名古屋: "Nagoya",
  那霸: "Naha",
  橫濱: "Yokohama",
  横浜: "Yokohama",
  台北: "Taipei",
  臺北: "Taipei",
  台中: "Taichung",
  高雄: "Kaohsiung",
  台南: "Tainan",
  首爾: "Seoul",
  釜山: "Busan",
};

const MAX_QUERIES = 8;

function cityEnglish(city: string): string {
  return CITY_EN[city] ?? city;
}

function uniqQueries(attempts: SearchAttempt[]): SearchAttempt[] {
  const seen = new Set<string>();
  const out: SearchAttempt[] = [];
  for (const a of attempts) {
    const key = `${a.mode}|${a.query.trim().toLowerCase()}`;
    if (!a.query.trim() || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
    if (out.length >= MAX_QUERIES) break;
  }
  return out;
}

function searchCity(input: PlaceRecommendationQueryBuildInput): string {
  return (
    input.resolvedSearchCity?.trim() ||
    input.destination.trim() ||
    ""
  );
}

/**
 * Build multilingual text-search attempts for a place recommendation intent.
 */
export function buildPlaceRecommendationQueries(
  input: PlaceRecommendationQueryBuildInput,
): SearchAttempt[] {
  const city = searchCity(input);
  if (!city) return [];
  const cityEn = cityEnglish(city);
  const subtypes = input.subtypes ?? [];
  const features = input.preferredFeatures ?? [];
  const attempts: SearchAttempt[] = [];

  if (input.primaryType === "restaurant" || (subtypes.length > 0 && input.primaryType !== "cafe")) {
    const included = ["restaurant", "japanese_restaurant", "food"];
    if (subtypes.length) {
      for (const id of subtypes.slice(0, 3)) {
        const tokens = cuisineSearchTokens(id);
        for (const tok of tokens.slice(0, 3)) {
          attempts.push({ query: `${city} ${tok}`, mode: "text", includedTypes: included });
        }
        attempts.push({
          query: `${cityEn} ${id.replace(/_/g, " ")} restaurant`,
          mode: "text",
          includedTypes: included,
        });
      }
    } else {
      attempts.push({ query: `${city} restaurant`, mode: "text", includedTypes: included });
      attempts.push({ query: `${city} 人氣餐廳`, mode: "text", includedTypes: included });
      attempts.push({
        query: `${cityEn} restaurant`,
        mode: "text",
        includedTypes: included,
      });
    }
    if (input.budget === "cheap") {
      attempts.push({
        query: `${city} 平價 ${subtypes[0] ? cuisineSearchTokens(subtypes[0])[0] : "餐廳"}`,
        mode: "text",
        includedTypes: included,
      });
    }
    if (input.mealSlot === "dinner") {
      attempts.push({
        query: `${city} 晚餐 ${subtypes[0] ? cuisineSearchTokens(subtypes[0])[0] : "餐廳"}`,
        mode: "text",
        includedTypes: included,
      });
    }
    return uniqQueries(attempts);
  }

  if (input.primaryType === "cafe") {
    const included = ["cafe", "coffee_shop"];
    attempts.push({ query: `${city} 咖啡廳`, mode: "text", includedTypes: included });
    attempts.push({ query: `${city} カフェ`, mode: "text", includedTypes: included });
    attempts.push({ query: `${cityEn} cafe`, mode: "text", includedTypes: included });
    if (features.includes("power_outlet") || features.includes("outlet")) {
      attempts.push({ query: `${city} 有插座 咖啡廳`, mode: "text", includedTypes: included });
      attempts.push({ query: `${city} 電源 カフェ`, mode: "text", includedTypes: included });
      attempts.push({
        query: `${cityEn} cafe power outlet`,
        mode: "text",
        includedTypes: included,
      });
      attempts.push({ query: `${city} coworking cafe`, mode: "text", includedTypes: included });
    }
    if (features.includes("sofa")) {
      attempts.push({ query: `${city} 沙發 咖啡廳`, mode: "text", includedTypes: included });
      attempts.push({ query: `${city} ソファ カフェ`, mode: "text", includedTypes: included });
      attempts.push({
        query: `${cityEn} cafe sofa seating`,
        mode: "text",
        includedTypes: included,
      });
      attempts.push({ query: `${city} lounge cafe`, mode: "text", includedTypes: included });
    }
    if (input.atmosphere?.includes("quiet") || features.includes("quiet")) {
      attempts.push({ query: `${city} 安靜 咖啡廳`, mode: "text", includedTypes: included });
    }
    return uniqQueries(attempts);
  }

  if (input.primaryType === "shopping") {
    const included = ["shopping_mall", "department_store", "clothing_store", "store"];
    const types = subtypes.length ? subtypes : ["department_store"];
    for (const id of types.slice(0, 3)) {
      for (const tok of shoppingTypeSearchTokens(id).slice(0, 2)) {
        attempts.push({ query: `${city} ${tok}`, mode: "text", includedTypes: included });
      }
      attempts.push({
        query: `${cityEn} ${id.replace(/_/g, " ")}`,
        mode: "text",
        includedTypes: included,
      });
    }
    return uniqQueries(attempts);
  }

  if (
    input.primaryType === "attraction" ||
    input.primaryType === "indoor" ||
    input.indoorOnly
  ) {
    const included = ["tourist_attraction", "museum", "art_gallery"];
    const types = subtypes.length
      ? subtypes
      : input.indoorOnly || input.primaryType === "indoor"
        ? ["indoor"]
        : ["culture"];
    for (const id of types.slice(0, 3)) {
      for (const tok of attractionTypeSearchTokens(id).slice(0, 2)) {
        attempts.push({ query: `${city} ${tok}`, mode: "text", includedTypes: included });
      }
    }
    if (input.indoorOnly || input.primaryType === "indoor") {
      attempts.push({ query: `${city} 室內景點`, mode: "text", includedTypes: included });
      attempts.push({
        query: `${cityEn} indoor attractions`,
        mode: "text",
        includedTypes: included,
      });
    }
    return uniqQueries(attempts);
  }

  if (input.primaryType === "nightlife") {
    const included = ["bar", "restaurant"];
    attempts.push({ query: `${city} 酒吧 居酒屋`, mode: "text", includedTypes: included });
    attempts.push({ query: `${cityEn} bar izakaya`, mode: "text", includedTypes: included });
    return uniqQueries(attempts);
  }

  attempts.push({
    query: `${city} 推薦`,
    mode: "text",
    includedTypes: ["tourist_attraction", "restaurant"],
  });
  return uniqQueries(attempts);
}

export function logPlaceRecommendationSearchStart(
  input: PlaceRecommendationQueryBuildInput,
  queries: string[],
): void {
  console.info(
    "[PLACE_RECOMMENDATION_SEARCH_START]",
    `destination=${input.destination}`,
    `resolvedCity=${input.resolvedSearchCity ?? ""}`,
    `primaryType=${input.primaryType}`,
    `subtypes=${(input.subtypes ?? []).join(",")}`,
    `queries=${queries.join(" | ")}`,
  );
}

export function logPlaceRecommendationSearchResult(stats: {
  rawCount: number;
  typeAccepted: number;
  subtypeAccepted: number;
  qualityRejected: number;
  duplicateRejected: number;
  finalCount: number;
}): void {
  console.info(
    "[PLACE_RECOMMENDATION_SEARCH_RESULT]",
    `rawCount=${stats.rawCount}`,
    `typeAccepted=${stats.typeAccepted}`,
    `subtypeAccepted=${stats.subtypeAccepted}`,
    `qualityRejected=${stats.qualityRejected}`,
    `duplicateRejected=${stats.duplicateRejected}`,
    `finalCount=${stats.finalCount}`,
  );
}
