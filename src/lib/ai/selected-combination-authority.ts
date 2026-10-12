import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { CombinationSelectionAllowlist } from "@/lib/ai/destination-combination-suggestions";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";

export type SelectedCombinationAuthorityFailure =
  | "no_selection"
  | "offered_missing"
  | "selection_not_offered"
  | "destination_mismatch"
  | "no_places";

export type SelectedCombinationAuthority =
  | {
      ok: true;
      allowlist: CombinationSelectionAllowlist;
      /** Provider ids carried by the offered snapshot; never inferred from names. */
      selectedPlaceIds: string[];
    }
  | { ok: false; reason: SelectedCombinationAuthorityFailure };

function placeKey(name: string): string {
  return name.trim().replace(/\s+/g, "").toLowerCase();
}

type SupplementCandidate = {
  id?: string | null;
  googlePlaceId?: string | null;
  placeId?: string | null;
  name?: string | null;
  placeName?: string | null;
};

/**
 * Supplement / refill guard: true when a candidate belongs only to combinations the user
 * did not select. Provider ids from the offered snapshot decide first (a selected id is
 * always kept, so shared places survive); names fall back to the existing
 * exclusiveExcludedPlaceNames contract, except when both ids are known and differ.
 */
export function createUnselectedOfferExclusion(
  selectedCombinationIds: number[],
  offeredCombinations: CanonicalTravelContext["offeredCombinations"],
  exclusiveExcludedPlaceNames: string[],
): (candidate: SupplementCandidate) => boolean {
  const selected = new Set(selectedCombinationIds);
  const selectedIds = new Set<string>();
  const unselectedIds = new Set<string>();
  const unselectedIdsByName = new Map<string, Set<string>>();
  for (const combo of offeredCombinations ?? []) {
    for (const place of combo.places) {
      const id = place.googlePlaceId?.trim();
      if (!id) continue;
      if (selected.has(combo.id)) {
        selectedIds.add(id);
        continue;
      }
      unselectedIds.add(id);
      for (const name of [place.originalName, place.name, place.localizedDisplayName]) {
        const key = name ? placeKey(name) : "";
        if (!key) continue;
        if (!unselectedIdsByName.has(key)) unselectedIdsByName.set(key, new Set());
        unselectedIdsByName.get(key)!.add(id);
      }
    }
  }
  for (const id of selectedIds) unselectedIds.delete(id);
  const excludedNames = new Set(exclusiveExcludedPlaceNames.map(placeKey).filter(Boolean));

  return (candidate) => {
    const id = (candidate.googlePlaceId ?? candidate.placeId ?? candidate.id)?.trim();
    if (id && selectedIds.has(id)) return false;
    if (id && unselectedIds.has(id)) return true;
    const key = placeKey(candidate.placeName ?? candidate.name ?? "");
    if (!key || !excludedNames.has(key)) return false;
    const knownIds = unselectedIdsByName.get(key);
    // Same name, different provider identity: a different place, not the unselected one.
    if (id && knownIds?.size && !knownIds.has(id)) return false;
    return true;
  };
}

/**
 * Selected-only authority for (re)generation: the structured offered snapshot the user
 * chose from, filtered by the selected ids. Titles and re-derived pools are never used,
 * so a cleared cache or an English style title cannot swap in an unselected combination.
 */
export function resolveSelectedCombinationAuthority(
  context: Pick<
    CanonicalTravelContext,
    "selectedCombinationIds" | "offeredCombinations" | "selectionSource"
  >,
  destination: string,
): SelectedCombinationAuthority {
  const ids = [...new Set(context.selectedCombinationIds ?? [])];
  if (!ids.length) return { ok: false, reason: "no_selection" };
  const offered = context.offeredCombinations ?? [];
  if (!offered.length) return { ok: false, reason: "offered_missing" };
  const selected = ids.map((id) => offered.find((combo) => combo.id === id));
  if (selected.some((combo) => !combo)) return { ok: false, reason: "selection_not_offered" };

  const scope = normalizeDestinationLabel(destination);
  const names: string[] = [];
  const seen = new Set<string>();
  const placeIds: string[] = [];
  for (const combo of selected) {
    for (const place of combo!.places) {
      if (place.destination && scope && normalizeDestinationLabel(place.destination) !== scope) {
        return { ok: false, reason: "destination_mismatch" };
      }
      const name = (place.originalName ?? place.name).trim();
      const key = placeKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      names.push(name);
      if (place.googlePlaceId?.trim()) placeIds.push(place.googlePlaceId.trim());
    }
  }
  if (!names.length) return { ok: false, reason: "no_places" };

  const excluded: string[] = [];
  for (const combo of offered) {
    if (ids.includes(combo.id)) continue;
    for (const place of combo.places) {
      const name = (place.originalName ?? place.name).trim();
      const key = placeKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      excluded.push(name);
    }
  }

  return {
    ok: true,
    allowlist: {
      selectedCombinationIds: ids,
      selectedCombinationIndexes: ids.map((id) => id - 1),
      allowedTitles: selected.map((combo) => combo!.title),
      allowedPlaceNames: names,
      excludedTitles: offered.filter((combo) => !ids.includes(combo.id)).map((combo) => combo.title),
      exclusiveExcludedPlaceNames: excluded,
      selectionSource: context.selectionSource,
    },
    selectedPlaceIds: placeIds,
  };
}
