import type {
  RecommendationCandidate,
  RecommendationCandidateSource,
} from "@/lib/recommendation/engine/types";

export type NormalizeInput = {
  placeId?: string | null;
  id?: string | null;
  name?: string | null;
  lat?: number | null;
  lng?: number | null;
  rating?: number | null;
  userRatingCount?: number | null;
  primaryType?: string | null;
  types?: string[] | null;
  openStatus?: string | null;
  openNow?: boolean | null;
  /** 若提供則優先作為 candidate.raw（Planner 需保留完整 PlaceResult） */
  raw?: unknown;
};

function resolvePlaceId(input: NormalizeInput, index: number): string {
  const raw = (input.placeId ?? input.id ?? "").toString().trim();
  if (raw) return raw;
  const name = (input.name ?? "").toString().trim();
  if (name) return `name:${name}`;
  return `anon:${index}`;
}

/**
 * normalize — 資料標準化為 RecommendationCandidate。
 * 保留 `raw` 以便 Adapter 還原原始物件（R0 行為零損失）。
 */
export function normalizeCandidates(
  inputs: readonly NormalizeInput[],
  source: RecommendationCandidateSource = "explore",
): RecommendationCandidate[] {
  return inputs.map((input, index) => {
    const openNow =
      input.openNow ??
      (input.openStatus === "open"
        ? true
        : input.openStatus === "closed_now" || input.openStatus === "closed"
          ? false
          : null);

    return {
      placeId: resolvePlaceId(input, index),
      name: (input.name ?? "").toString(),
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      rating: input.rating ?? null,
      userRatingCount: input.userRatingCount ?? null,
      primaryType: input.primaryType ?? null,
      types: input.types ?? null,
      openNow,
      openStatus: input.openStatus ?? null,
      source,
      raw: input.raw ?? input,
    };
  });
}
