/**
 * Continuation dedupe: only identities actually shown to the user.
 * SEARCHED_CANDIDATE != SHOWN_RECOMMENDATION.
 */
import type { ConversationRecommendationSession } from "@/lib/ai/conversation-recommendation-session";
import { shoppingCanonicalKey } from "@/lib/ai/shopping-query-queue";
import {
  placeIdentityKey,
  type PlaceLike,
} from "@/lib/place-planning-memory";

export type ContinuationDedupeBreakdown = {
  inputCount: number;
  keptCount: number;
  matchedByPlaceId: number;
  matchedByCanonicalKey: number;
  matchedAgainstDisplayed: number;
  matchedAgainstMerelySearched: number;
  matchedAgainstStoredPool: number;
};

type ContinuationPlaceLike = PlaceLike & {
  id?: string | null;
  googlePlaceId?: string | null;
};

function stripIdentityPrefix(value: string): string {
  return value.replace(/^(?:id:|google:|canonical:)/, "").trim();
}

function identityVariants(value: string | null | undefined): string[] {
  const token = (value ?? "").trim();
  if (!token) return [];
  if (token.startsWith("n:") || token.startsWith("na:")) return [token];
  const raw = stripIdentityPrefix(token);
  if (!raw) return [token];
  return [...new Set([token, raw, `id:${raw}`, `google:${raw}`])];
}

function expandIdentitySet(values: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const value of values) {
    for (const variant of identityVariants(value)) out.add(variant);
  }
  return out;
}

function placeCanonicalKey(place: ContinuationPlaceLike): string {
  return shoppingCanonicalKey({
    name: place.name,
    placeName: place.placeName,
    googlePlaceId: place.googlePlaceId,
    placeId: place.placeId ?? place.id,
  });
}

export function shownRecommendationIdentitiesFromSession(
  session:
    | Pick<ConversationRecommendationSession, "returnedPlaceIds" | "returnedCanonicalKeys">
    | null
    | undefined,
  extraPlaceIds: readonly string[] = [],
): { placeIds: string[]; canonicalKeys: string[] } {
  const placeIds = [
    ...new Set(
      [...(session?.returnedPlaceIds ?? []), ...extraPlaceIds]
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  const canonicalKeys = [
    ...new Set(
      [...(session?.returnedCanonicalKeys ?? []), ...placeIds]
        .map((key) => key.trim())
        .filter((key) => key && key !== "n:"),
    ),
  ];
  return { placeIds, canonicalKeys };
}

export function storedPoolPlaceIdsFromSession(
  session: Pick<ConversationRecommendationSession, "pool"> | null | undefined,
): string[] {
  if (!session?.pool?.length) return [];
  return [
    ...new Set(
      session.pool
        .map(
          (item) =>
            (item.googlePlaceId ?? (item as { placeId?: string }).placeId ?? "").trim(),
        )
        .filter(Boolean),
    ),
  ];
}

/** Drop only identities the user has already seen. Unshown search/pool hits stay. */
export function filterContinuationByShownIdentity<T extends PlaceLike>(
  candidates: T[],
  params: {
    shownPlaceIds: readonly string[];
    shownCanonicalKeys?: readonly string[];
    merelySearchedPlaceIds?: readonly string[];
    storedPoolPlaceIds?: readonly string[];
  },
): { kept: T[]; breakdown: ContinuationDedupeBreakdown } {
  const shownIds = expandIdentitySet(params.shownPlaceIds);
  const shownKeys = expandIdentitySet([
    ...(params.shownCanonicalKeys ?? []),
    ...params.shownPlaceIds,
  ]);
  const searchedIds = expandIdentitySet(params.merelySearchedPlaceIds ?? []);
  const poolIds = expandIdentitySet(params.storedPoolPlaceIds ?? []);

  let matchedByPlaceId = 0;
  let matchedByCanonicalKey = 0;
  let matchedAgainstDisplayed = 0;
  let matchedAgainstMerelySearched = 0;
  let matchedAgainstStoredPool = 0;
  const kept: T[] = [];

  for (const candidate of candidates) {
    const place = candidate as T & ContinuationPlaceLike;
    const identity = placeIdentityKey(place);
    const canonical = placeCanonicalKey(place);
    const shownIdHit = Boolean(
      (identity && shownIds.has(identity)) ||
        (place.id && shownIds.has(place.id)) ||
        (place.googlePlaceId && shownIds.has(place.googlePlaceId)) ||
        (place.placeId && shownIds.has(place.placeId)),
    );
    const shownKeyHit = Boolean(canonical && shownKeys.has(canonical));

    if (shownIdHit || shownKeyHit) {
      if (shownIdHit) matchedByPlaceId += 1;
      else matchedByCanonicalKey += 1;
      matchedAgainstDisplayed += 1;
      continue;
    }

    if (
      (identity && searchedIds.has(identity)) ||
      (place.id && searchedIds.has(place.id))
    ) {
      matchedAgainstMerelySearched += 1;
    }
    if (
      (identity && poolIds.has(identity)) ||
      (place.id && poolIds.has(place.id))
    ) {
      matchedAgainstStoredPool += 1;
    }
    kept.push(candidate);
  }

  return {
    kept,
    breakdown: {
      inputCount: candidates.length,
      keptCount: kept.length,
      matchedByPlaceId,
      matchedByCanonicalKey,
      matchedAgainstDisplayed,
      matchedAgainstMerelySearched,
      matchedAgainstStoredPool,
    },
  };
}
