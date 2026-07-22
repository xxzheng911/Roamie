/**
 * Shopping search scope — resolve active city / centroid / geo clusters
 * so region labels (北海道) do not drive follow-up text queries.
 */
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { resolveDestinationEntity } from "@/lib/ai/destination-entity";
import { resolveDestinationApproxCenter } from "@/lib/ai/destination-geocode";
import { applyCityLocaleAlias } from "@/lib/ai/destination-locale-aliases";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { distanceMeters } from "@/lib/map-explore";

export type ShoppingSearchScope = {
  /** Display / primary destination (may be region, e.g. 北海道) */
  primaryDestination: string;
  /** City used as query prefix (e.g. 札幌) */
  activeSearchCity: string;
  searchRegionLabel: string;
  country?: string;
  searchCentroid: { lat: number; lng: number };
  searchRadius: number;
  geoClusterIndex: number;
  geoClusterLabel?: string;
};

export type ShoppingGeoCluster = {
  label: string;
  lat: number;
  lng: number;
  /** Prefer for outlet / suburban rounds */
  outlet?: boolean;
};

/** Region → preferred search city (first hub for shopping queries). */
const REGION_PRIMARY_CITY: Record<string, string> = {
  北海道: "札幌",
  九州: "福岡",
  四國: "高松",
  本州: "東京",
  沖繩: "那霸",
  冲绳: "那霸",
  濟州: "濟州市",
  濟州島: "濟州市",
  屏東: "屏東市區",
  宜蘭: "宜蘭市",
  花蓮: "花蓮市",
  台東: "台東市",
  臺東: "台東市",
  南投: "南投市",
  嘉義: "嘉義市",
  彰化: "彰化市",
  新竹: "新竹市",
};

/** Known city geo clusters for follow-up rotation. */
const CITY_GEO_CLUSTERS: Record<string, ShoppingGeoCluster[]> = {
  札幌: [
    { label: "札幌站", lat: 43.0686, lng: 141.3508 },
    { label: "大通", lat: 43.0604, lng: 141.3544 },
    { label: "狸小路／薄野", lat: 43.0554, lng: 141.353 },
    { label: "札幌Factory", lat: 43.0665, lng: 141.3635 },
    { label: "琴似", lat: 43.075, lng: 141.303 },
    { label: "新札幌", lat: 43.038, lng: 141.472 },
    { label: "北廣島outlet", lat: 42.985, lng: 141.56, outlet: true },
  ],
  東京: [
    { label: "新宿", lat: 35.6896, lng: 139.7006 },
    { label: "澀谷", lat: 35.658, lng: 139.7016 },
    { label: "銀座", lat: 35.6717, lng: 139.765 },
    { label: "池袋", lat: 35.7295, lng: 139.7109 },
    { label: "台場", lat: 35.6295, lng: 139.779 },
  ],
  大阪: [
    { label: "梅田", lat: 34.7024, lng: 135.4959 },
    { label: "難波", lat: 34.6654, lng: 135.5023 },
    { label: "心齋橋", lat: 34.6695, lng: 135.5013 },
  ],
};

const CITY_TOKEN_RE =
  /(?:札幌|sapporo|東京|tokyo|大阪|osaka|京都|kyoto|福岡|fukuoka|那霸|naha|名古屋|橫濱|横浜|首爾|釜山|台北|臺北|台中|高雄)/i;

const CITY_NORMALIZE: Record<string, string> = {
  sapporo: "札幌",
  tokyo: "東京",
  osaka: "大阪",
  kyoto: "京都",
  fukuoka: "福岡",
  naha: "那霸",
  横浜: "橫濱",
  臺北: "台北",
};

export const SHOPPING_RADIUS_ROUND1_M = 4_000;
export const SHOPPING_RADIUS_ROUND2_M = 8_000;
export const SHOPPING_RADIUS_ROUND3_M = 15_000;

function normalizeCityToken(raw: string): string {
  const t = applyCityLocaleAlias(raw.trim());
  const lower = t.toLowerCase();
  return CITY_NORMALIZE[lower] ?? t;
}

function extractCityFromText(text: string): string | null {
  const m = text.match(CITY_TOKEN_RE);
  if (!m?.[0]) return null;
  return normalizeCityToken(m[0]);
}

function centroidOfPlaces(
  places: Array<{ lat?: number | null; lng?: number | null }>,
): { lat: number; lng: number } | null {
  const pts = places.filter(
    (p) =>
      p.lat != null &&
      p.lng != null &&
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lng),
  );
  if (!pts.length) return null;
  const lat = pts.reduce((s, p) => s + (p.lat as number), 0) / pts.length;
  const lng = pts.reduce((s, p) => s + (p.lng as number), 0) / pts.length;
  return { lat, lng };
}

export function resolveRegionPrimaryCity(destination: string): string | null {
  const label = normalizeDestinationLabel(destination);
  return REGION_PRIMARY_CITY[label] ?? null;
}

export function getShoppingGeoClusters(city: string): ShoppingGeoCluster[] {
  const key = normalizeDestinationLabel(city);
  return CITY_GEO_CLUSTERS[key] ?? [];
}

/**
 * Infer active search city from destination + already-shown places.
 * Region「北海道」+ places in 札幌 → activeSearchCity=札幌.
 */
export function resolveShoppingSearchScope(params: {
  destination: string;
  countryHint?: string | null;
  shownPlaces?: Array<{
    name?: string | null;
    placeName?: string | null;
    address?: string | null;
    lat?: number | null;
    lng?: number | null;
  }>;
  existingScope?: Partial<ShoppingSearchScope> | null;
  geoClusterIndex?: number;
  searchRadius?: number;
  preferOutletCluster?: boolean;
}): ShoppingSearchScope {
  const primaryDestination = normalizeDestinationLabel(params.destination);
  const entity = resolveDestinationEntity(primaryDestination);
  const country =
    params.countryHint?.trim() ||
    entity.country ||
    params.existingScope?.country;

  let activeSearchCity =
    params.existingScope?.activeSearchCity?.trim() ||
    (entity.type === "city" || entity.type === "attraction"
      ? primaryDestination
      : resolveRegionPrimaryCity(primaryDestination) ?? "");

  // Prefer city evidenced by shown recommendation addresses / names.
  if (params.shownPlaces?.length) {
    const votes = new Map<string, number>();
    for (const place of params.shownPlaces) {
      const blob = `${place.name ?? ""} ${place.placeName ?? ""} ${place.address ?? ""}`;
      const city = extractCityFromText(blob);
      if (!city) continue;
      votes.set(city, (votes.get(city) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestN = 0;
    for (const [city, n] of votes) {
      if (n > bestN) {
        best = city;
        bestN = n;
      }
    }
    if (best) activeSearchCity = best;
  }

  if (!activeSearchCity) {
    activeSearchCity =
      resolveRegionPrimaryCity(primaryDestination) ?? primaryDestination;
  }

  const clusters = getShoppingGeoClusters(activeSearchCity);
  let geoClusterIndex = Math.max(
    0,
    params.geoClusterIndex ?? params.existingScope?.geoClusterIndex ?? 0,
  );
  if (params.preferOutletCluster) {
    const outletIdx = clusters.findIndex((c) => c.outlet);
    if (outletIdx >= 0) geoClusterIndex = outletIdx;
  }
  if (clusters.length) {
    geoClusterIndex = geoClusterIndex % clusters.length;
  }

  const fromPlaces = centroidOfPlaces(params.shownPlaces ?? []);
  const cityApprox = resolveDestinationApproxCenter(activeSearchCity, country);
  const destApprox = resolveDestinationApproxCenter(primaryDestination, country);

  // First resolve with shown places: prefer cluster nearest to result centroid.
  if (
    fromPlaces &&
    clusters.length &&
    params.geoClusterIndex == null &&
    !params.existingScope?.searchCentroid &&
    !params.preferOutletCluster
  ) {
    let nearest = 0;
    let nearestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i]!;
      if (c.outlet) continue;
      const d = distanceMeters(fromPlaces, { lat: c.lat, lng: c.lng });
      if (d < nearestDist) {
        nearestDist = d;
        nearest = i;
      }
    }
    geoClusterIndex = nearest;
  }

  const cluster = clusters[geoClusterIndex];
  let searchCentroid =
    params.existingScope?.searchCentroid &&
    params.geoClusterIndex == null &&
    !params.preferOutletCluster
      ? params.existingScope.searchCentroid
      : cluster
        ? { lat: cluster.lat, lng: cluster.lng }
        : fromPlaces ??
          cityApprox ??
          destApprox ??
          params.existingScope?.searchCentroid ?? {
            lat: 0,
            lng: 0,
          };

  // When snapping to a geo cluster, always use that cluster's coordinates.
  if (cluster && (params.geoClusterIndex != null || fromPlaces || params.preferOutletCluster)) {
    searchCentroid = { lat: cluster.lat, lng: cluster.lng };
  }

  const searchRadius =
    params.searchRadius ??
    params.existingScope?.searchRadius ??
    SHOPPING_RADIUS_ROUND1_M;

  const scope: ShoppingSearchScope = {
    primaryDestination,
    activeSearchCity,
    searchRegionLabel: primaryDestination,
    country,
    searchCentroid,
    searchRadius,
    geoClusterIndex,
    geoClusterLabel: cluster?.label ?? activeSearchCity,
  };

  logAiPipeline(
    "[SHOPPING_SEARCH_SCOPE]",
    `primaryDestination=${scope.primaryDestination}`,
    `activeSearchCity=${scope.activeSearchCity}`,
    `country=${scope.country ?? ""}`,
    `lat=${scope.searchCentroid.lat.toFixed(4)}`,
    `lng=${scope.searchCentroid.lng.toFixed(4)}`,
    `radius=${scope.searchRadius}`,
    `geoCluster=${scope.geoClusterLabel ?? ""}`,
    `geoClusterIndex=${scope.geoClusterIndex}`,
  );

  return scope;
}

/** Advance geo cluster and/or expand radius for the next follow-up round. */
export function advanceShoppingSearchScope(
  scope: ShoppingSearchScope,
  opts?: { preferOutlet?: boolean },
): ShoppingSearchScope {
  const clusters = getShoppingGeoClusters(scope.activeSearchCity);
  let nextIndex = scope.geoClusterIndex + 1;
  let nextRadius = scope.searchRadius;

  if (opts?.preferOutlet) {
    const outletIdx = clusters.findIndex((c) => c.outlet);
    if (outletIdx >= 0 && outletIdx !== scope.geoClusterIndex) {
      return resolveShoppingSearchScope({
        destination: scope.primaryDestination,
        countryHint: scope.country,
        existingScope: scope,
        geoClusterIndex: outletIdx,
        searchRadius: Math.max(scope.searchRadius, SHOPPING_RADIUS_ROUND3_M),
        preferOutletCluster: true,
      });
    }
  }

  if (clusters.length && nextIndex < clusters.length) {
    // Skip outlet clusters until later unless preferred.
    while (
      nextIndex < clusters.length &&
      clusters[nextIndex]?.outlet &&
      !opts?.preferOutlet
    ) {
      nextIndex += 1;
    }
  }

  if (!clusters.length || nextIndex >= clusters.length) {
    // Expand radius; reset to first non-outlet cluster.
    nextIndex = 0;
    if (scope.searchRadius < SHOPPING_RADIUS_ROUND2_M) {
      nextRadius = SHOPPING_RADIUS_ROUND2_M;
    } else if (scope.searchRadius < SHOPPING_RADIUS_ROUND3_M) {
      nextRadius = SHOPPING_RADIUS_ROUND3_M;
    } else {
      nextRadius = SHOPPING_RADIUS_ROUND3_M;
      // Stay on last urban cluster when fully expanded.
      nextIndex = Math.max(0, clusters.findIndex((c) => !c.outlet));
      if (nextIndex < 0) nextIndex = 0;
    }
  }

  return resolveShoppingSearchScope({
    destination: scope.primaryDestination,
    countryHint: scope.country,
    existingScope: scope,
    geoClusterIndex: nextIndex,
    searchRadius: nextRadius,
  });
}

export function shoppingScopeExhausted(scope: ShoppingSearchScope): boolean {
  const clusters = getShoppingGeoClusters(scope.activeSearchCity);
  if (!clusters.length) {
    return scope.searchRadius >= SHOPPING_RADIUS_ROUND3_M;
  }
  const urbanCount = clusters.filter((c) => !c.outlet).length;
  return (
    scope.searchRadius >= SHOPPING_RADIUS_ROUND3_M &&
    scope.geoClusterIndex >= Math.max(0, urbanCount - 1)
  );
}

const CLUSTER_COVERED_RADIUS_M = 900;

/**
 * Prefer a geo cluster that first-round results have not already covered.
 * Uses existing city cluster table — not a global hardcoded district list.
 */
export function preferUnderrepresentedShoppingCluster(
  scope: ShoppingSearchScope,
  shownPlaces: Array<{ lat?: number | null; lng?: number | null }>,
): { scope: ShoppingSearchScope; coveredClusterLabels: string[]; selectedLabel?: string } {
  const clusters = getShoppingGeoClusters(scope.activeSearchCity);
  if (!clusters.length) {
    return { scope, coveredClusterLabels: [] };
  }

  const coveredLabels: string[] = [];
  const coveredIdx = new Set<number>();
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i]!;
    if (c.outlet) continue;
    for (const p of shownPlaces) {
      if (p.lat == null || p.lng == null) continue;
      if (
        distanceMeters(
          { lat: p.lat, lng: p.lng },
          { lat: c.lat, lng: c.lng },
        ) <= CLUSTER_COVERED_RADIUS_M
      ) {
        coveredIdx.add(i);
        coveredLabels.push(c.label);
        break;
      }
    }
  }

  let nextIndex = -1;
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i]!;
    if (c.outlet) continue;
    if (!coveredIdx.has(i)) {
      nextIndex = i;
      break;
    }
  }

  if (nextIndex < 0) {
    // All urban clusters touched — advance via normal rotation.
    const advanced = advanceShoppingSearchScope(scope);
    return {
      scope: advanced,
      coveredClusterLabels: [...new Set(coveredLabels)],
      selectedLabel: advanced.geoClusterLabel,
    };
  }

  if (nextIndex === scope.geoClusterIndex) {
    return {
      scope,
      coveredClusterLabels: [...new Set(coveredLabels)],
      selectedLabel: scope.geoClusterLabel,
    };
  }

  const next = resolveShoppingSearchScope({
    destination: scope.primaryDestination,
    countryHint: scope.country,
    existingScope: scope,
    geoClusterIndex: nextIndex,
    searchRadius: scope.searchRadius,
  });
  return {
    scope: next,
    coveredClusterLabels: [...new Set(coveredLabels)],
    selectedLabel: next.geoClusterLabel,
  };
}
