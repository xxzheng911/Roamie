/**
 * Roamie Plus — reserved structure on top of `conversation_context.plus_memory`.
 * Populated later from profile, saves, and trip history analysis.
 */
export type PlusConversationMemory = {
  likes?: string[];
  dislikes?: string[];
  favoriteCountries?: string[];
  savedPlacePatterns?: string[];
  travelPersonality?: string;
  notes?: string;
};

export const EMPTY_PLUS_CONVERSATION_MEMORY: PlusConversationMemory = {};
