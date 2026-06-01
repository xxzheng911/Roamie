/**
 * Roamie Plus — long-term travel memory on `conversation_context.plus_memory`.
 * Populated from profile, saves, trip history, and chat preference extraction.
 * @see docs/PRODUCT_ARCHITECTURE.md
 */
export type PlusConversationMemory = {
  /** Explicit likes/dislikes from chat or quiz */
  likes?: string[];
  dislikes?: string[];
  /** Geographic preferences */
  favoriteCountries?: string[];
  favoriteCities?: string[];
  /** Category patterns */
  favoritePlaceTypes?: string[];
  favoriteRestaurantTypes?: string[];
  accommodationStyle?: string;
  /** Budget & mobility */
  budgetRange?: string;
  preferredTransport?: string;
  travelPace?: string;
  /** From preference quiz / Travel Profile */
  travelPersonality?: string;
  /** AI-generated tags from collection analysis */
  collectionInsightTags?: string[];
  savedPlacePatterns?: string[];
  notes?: string;
};

export const EMPTY_PLUS_CONVERSATION_MEMORY: PlusConversationMemory = {};
