/**
 * Places Cost Cache — TTL and category caps (Beta cost protection).
 * Same destination → one Candidate Pool; all combos / chat / regenerates share it.
 */

/** Layer 1 Destination Cache + Layer 2 Candidate Pool + Layer 3 Combination */
export const PLACES_COST_CACHE_TTL_MS = 30 * 60 * 1000;

/** Same session + same query must not re-hit Places within this window. */
export const PLACES_QUERY_COOLDOWN_MS = 5_000;

/**
 * First Candidate Pool build: at most one Places Search per category.
 * Maps to Google includedTypes / plan kinds.
 */
export const CANDIDATE_POOL_SEED_CATEGORIES = [
  {
    id: "tourist_attractions",
    label: "Tourist Attractions",
    kind: "attraction" as const,
    includedTypes: ["tourist_attraction"],
    querySuffix: "tourist attractions",
  },
  {
    id: "restaurant",
    label: "Restaurant",
    kind: "restaurant" as const,
    includedTypes: ["restaurant"],
    querySuffix: "restaurants",
  },
  {
    id: "cafe",
    label: "Cafe",
    kind: "cafe" as const,
    includedTypes: ["cafe", "coffee_shop"],
    querySuffix: "cafes",
  },
  {
    id: "shopping",
    label: "Shopping",
    kind: "shopping" as const,
    includedTypes: ["shopping_mall", "department_store", "clothing_store"],
    querySuffix: "shopping",
  },
  {
    id: "entertainment",
    label: "Entertainment",
    kind: "attraction" as const,
    includedTypes: ["amusement_park", "movie_theater", "night_club", "bar"],
    querySuffix: "entertainment",
  },
] as const;

export type CandidatePoolSeedCategoryId =
  (typeof CANDIDATE_POOL_SEED_CATEGORIES)[number]["id"];
