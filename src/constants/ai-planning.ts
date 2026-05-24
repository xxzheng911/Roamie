/**
 * Roamie conversational planning phases.
 * AI should progress discover → recommend → enrich → confirm before itinerary handoff.
 */
export const AIPlanningPhases = {
  /** Warm opening — mood, intention, no itinerary yet */
  DISCOVER: "discover",
  /** Suggest 2–5 places; ask if direction feels right */
  RECOMMEND: "recommend",
  /** User picked a place — continue naturally, ask transport / pace / budget */
  ENRICH: "enrich",
  /** Enough context gathered — offer to draft route */
  CONFIRM: "confirm",
  /** Generate structured itinerary */
  HANDOFF: "handoff",
} as const;

export type AIPlanningPhase = (typeof AIPlanningPhases)[keyof typeof AIPlanningPhases];

/** Minimum signals before itinerary generation is allowed */
export const ITINERARY_READY_SIGNALS = [
  "destination",
  "selectedPlaces",
  "paceOrVibe",
  "transportPreference",
] as const;

/** Companion-style follow-up prompts (used in prompts / UI hints) */
export const COMPANION_FOLLOW_UPS = {
  afterPlaceSelect: [
    "這個方向你喜歡嗎？要不要我再幫你找 2～3 個順路的點？",
    "接下來想走路、搭車，還是慢慢晃就好？",
    "今天比較想輕鬆發呆，還是想多看看？",
  ],
  beforeItinerary: [
    "我大概懂你的步調了。要我幫你把這幾個點排成一段舒服的路線嗎？",
    "如果差不多了，我可以幫你串成一小段行程，還想再加什麼嗎？",
  ],
} as const;
