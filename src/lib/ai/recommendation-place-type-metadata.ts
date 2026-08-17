/**
 * PlaceResult → RecommendationItem type metadata contract.
 * Render guards must see Google primaryType plus the full types[] array.
 * Never collapse types to [displayType] / [item.type].
 */

export type RecommendationPlaceTypeMetadata = {
  primaryType: string | null;
  types: string[];
};

function normalizeTypeToken(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function uniqueTypes(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const token = normalizeTypeToken(value);
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

export function resolveRecommendationPlaceTypeMetadata(params: {
  placePrimaryType?: string | null;
  placeTypes?: string[] | null;
  itemPrimaryType?: string | null;
  itemTypes?: string[] | null;
  itemType?: string | null;
}): RecommendationPlaceTypeMetadata {
  const primaryType =
    normalizeTypeToken(params.placePrimaryType) ||
    normalizeTypeToken(params.itemPrimaryType) ||
    normalizeTypeToken(params.itemType) ||
    null;

  const types = uniqueTypes([
    ...(params.placeTypes ?? []),
    ...(params.itemTypes ?? []),
  ]);

  if (types.length === 0 && primaryType) {
    types.push(primaryType);
  }

  return { primaryType, types };
}

export function recommendationTypeMetadataFromPlace(place: {
  primaryType?: string | null;
  types?: string[] | null;
}): RecommendationPlaceTypeMetadata {
  return resolveRecommendationPlaceTypeMetadata({
    placePrimaryType: place.primaryType,
    placeTypes: place.types,
  });
}

export function recommendationTypeMetadataFromItem(item: {
  primaryType?: string | null;
  types?: string[] | null;
  type?: string | null;
}): RecommendationPlaceTypeMetadata {
  return resolveRecommendationPlaceTypeMetadata({
    itemPrimaryType: item.primaryType,
    itemTypes: item.types,
    itemType: item.type,
  });
}

export function applyRecommendationPlaceTypeMetadata<T extends {
  primaryType?: string | null;
  types?: string[] | null;
  type?: string | null;
}>(
  item: T,
  place?: {
    primaryType?: string | null;
    types?: string[] | null;
  } | null,
): T {
  const metadata = resolveRecommendationPlaceTypeMetadata({
    placePrimaryType: place?.primaryType,
    placeTypes: place?.types,
    itemPrimaryType: item.primaryType,
    itemTypes: item.types,
    itemType: item.type,
  });
  return {
    ...item,
    primaryType: metadata.primaryType,
    types: metadata.types,
  };
}
