import type { PlaceResult } from "@/lib/place-result";

export type DestinationAreaSourceScope =
  | "area_primary"
  | "area_relaxed"
  | "city_primary"
  | "city_relaxed";

export type DestinationAreaCandidate = {
  place: PlaceResult;
  sourceScope: DestinationAreaSourceScope;
  sourceAttempt: string;
  areaMatched: boolean;
  parentCityMatched: boolean;
};

export function selectAreaFirstCandidates(
  areaCandidates: DestinationAreaCandidate[],
  cityCandidates: DestinationAreaCandidate[],
  target: number,
  options: { explicitAreaConstraint?: boolean } = {},
): DestinationAreaCandidate[] {
  const seen = new Set<string>();
  const selected: DestinationAreaCandidate[] = [];
  const append = (candidate: DestinationAreaCandidate) => {
    const identity = (candidate.place.id ?? candidate.place.name ?? "").trim();
    if (!identity || seen.has(identity) || selected.length >= target) return;
    seen.add(identity);
    selected.push(candidate);
  };
  areaCandidates
    .filter(
      (candidate) =>
        !options.explicitAreaConstraint ||
        (candidate.areaMatched && candidate.parentCityMatched),
    )
    .forEach(append);
  if (!options.explicitAreaConstraint) cityCandidates.forEach(append);
  return selected;
}
