import { mergeExploreRecommendations } from "@/lib/explore-primary-place";

/** One visible result set drives cards, markers and count during both phases. */
export function exploreSearchPresentation<T extends { id: string }>(input: {
  primary: T | null;
  recommendations: T[];
  primarySearchLoading: boolean;
  backgroundRecommendationLoading: boolean;
}) {
  const places = input.primarySearchLoading
    ? []
    : mergeExploreRecommendations(input.primary, input.recommendations);
  const pending = input.primarySearchLoading || input.backgroundRecommendationLoading;
  return {
    places,
    fullLoading: pending && places.length === 0,
    backgroundLoading: input.backgroundRecommendationLoading && places.length > 0,
    showEmpty: !pending && places.length === 0,
  };
}
