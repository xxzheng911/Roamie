import type { SearchAttempt } from "@/lib/ai/chat-place-recommendation";
import { EN_CITY_NAMES } from "@/lib/ai/destination-geocode";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { logChatCafeQuery } from "@/lib/ai/chat-place-flow-log";

function destinationEnLabel(destination: string): string {
  const label = normalizeDestinationLabel(destination);
  return EN_CITY_NAMES[label] ?? label;
}

export function buildCafeRelaxedSearchAttempts(
  destination: string,
  enLabel?: string,
): SearchAttempt[] {
  const label = normalizeDestinationLabel(destination);
  const en = enLabel ?? destinationEnLabel(label);
  const attempts: SearchAttempt[] = [
    { query: `${en} specialty coffee`, mode: "text", includedTypes: ["cafe", "coffee_shop"] },
    { query: `${en} brunch cafe`, mode: "text", includedTypes: ["cafe", "coffee_shop"] },
    { query: `${en} dessert cafe`, mode: "text", includedTypes: ["cafe", "coffee_shop"] },
  ];
  for (const attempt of attempts) {
    logChatCafeQuery(attempt.query, true);
  }
  return attempts;
}

export function buildCafeSearchAttempts(destination: string): {
  primary: SearchAttempt[];
  fallback: SearchAttempt[];
} {
  const label = normalizeDestinationLabel(destination);
  const en = destinationEnLabel(label);
  const primary: SearchAttempt[] = [
    { query: `${en} coffee shop`, mode: "text", includedTypes: ["cafe", "coffee_shop"] },
    { query: `${en} cafe`, mode: "text", includedTypes: ["cafe", "coffee_shop"] },
    { query: `${label} 人気 カフェ`, mode: "text", includedTypes: ["cafe", "coffee_shop"] },
    { query: `${label} 咖啡廳`, mode: "text", includedTypes: ["cafe", "coffee_shop"] },
  ];
  for (const attempt of primary) {
    logChatCafeQuery(attempt.query);
  }
  return {
    primary,
    fallback: buildCafeRelaxedSearchAttempts(label, en),
  };
}
