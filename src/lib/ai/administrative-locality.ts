import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { REGION_NODES, type RegionNode } from "@/lib/ai/region-adjacency/graph";

export type AdministrativeEvidenceSource =
  | "destination_alias"
  | "formatted_address_city"
  | "formatted_address_district"
  | "none";

export type AdministrativeLocalityResolution = {
  country?: string;
  canonicalCity?: string;
  canonicalDistrict?: string;
  confidence: "high" | "none";
  evidenceSource: AdministrativeEvidenceSource;
};

type IndexedAlias = { token: string; node: RegionNode; label: string };

export function normalizeAdministrativeAlias(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/臺/g, "台")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function uniqueAliases(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))];
}

const cityAliases: IndexedAlias[] = REGION_NODES.flatMap((node) =>
  uniqueAliases([node.id, ...(node.aliases ?? []), node.adminArea, ...(node.administrativeAliases ?? [])])
    .map((label) => ({ token: normalizeAdministrativeAlias(label), node, label }))
    .filter(({ token }) => token.length >= 2),
).sort((a, b) => b.token.length - a.token.length);

const districtAliases: IndexedAlias[] = REGION_NODES.flatMap((node) =>
  (node.districtAliases ?? [])
    .map((label) => ({ token: normalizeAdministrativeAlias(label), node, label }))
    .filter(({ token }) => token.length >= 2),
).sort((a, b) => b.token.length - a.token.length);

function uniqueNode(matches: IndexedAlias[]): IndexedAlias | null {
  const nodeIds = new Set(matches.map(({ node }) => node.id));
  return nodeIds.size === 1 ? matches[0] ?? null : null;
}

function exactCity(value: string): IndexedAlias | null {
  const token = normalizeAdministrativeAlias(value);
  return uniqueNode(cityAliases.filter((entry) => entry.token === token));
}

function containedMatches(value: string, index: IndexedAlias[]): IndexedAlias[] {
  const token = normalizeAdministrativeAlias(value);
  const latinWords = value.normalize("NFKC").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const matches = index.filter((entry) => {
    if (!/^[a-z0-9]+$/.test(entry.token)) {
      const position = token.indexOf(entry.token);
      if (position < 0) return false;
      if (entry.node.countryCode !== "KR" || position === 0) return true;
      return !/\p{Script=Hangul}/u.test(token[position - 1] ?? "");
    }
    const aliasWords = entry.label.normalize("NFKC").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return Boolean(aliasWords && (` ${latinWords} `).includes(` ${aliasWords} `));
  });
  const longest = matches[0]?.token.length ?? 0;
  return matches.filter((entry) => entry.token.length === longest);
}

export function destinationAdministrativeAliases(destination: string): string[] {
  const match = exactCity(normalizeDestinationLabel(destination)) ?? exactCity(destination);
  if (!match) return [];
  return uniqueAliases([
    match.node.id,
    ...(match.node.aliases ?? []),
    match.node.adminArea,
    ...(match.node.administrativeAliases ?? []),
  ]);
}

export function resolveAdministrativeLocality(params: {
  value?: string | null;
  source: "destination" | "formatted_address";
  preferredCity?: string;
}): AdministrativeLocalityResolution {
  const value = params.value?.trim() ?? "";
  if (!value) return { confidence: "none", evidenceSource: "none" };

  if (params.source === "destination") {
    const match = exactCity(normalizeDestinationLabel(value)) ?? exactCity(value);
    return match
      ? {
          country: match.node.countryCode,
          canonicalCity: match.node.id,
          confidence: "high",
          evidenceSource: "destination_alias",
        }
      : { confidence: "none", evidenceSource: "none" };
  }

  const city = uniqueNode(containedMatches(value, cityAliases));
  if (city) {
    const preferredDistricts = districtAliases.filter(
      (entry) => entry.node.id === city.node.id,
    );
    const district = uniqueNode(containedMatches(value, preferredDistricts));
    return {
      country: city.node.countryCode,
      canonicalCity: city.node.id,
      canonicalDistrict: district?.label,
      confidence: "high",
      evidenceSource: "formatted_address_city",
    };
  }

  const districtMatches = containedMatches(value, districtAliases);
  const contextualDistricts = params.preferredCity
    ? districtMatches.filter(({ node }) => node.id === params.preferredCity)
    : districtMatches;
  const district = uniqueNode(contextualDistricts);
  return district
    ? {
        country: district.node.countryCode,
        canonicalCity: district.node.id,
        canonicalDistrict: district.label,
        confidence: "high",
        evidenceSource: "formatted_address_district",
      }
    : { confidence: "none", evidenceSource: "none" };
}

export function resolveAdministrativeScope(destination: string, candidateAddress?: string | null) {
  const destinationLocality = resolveAdministrativeLocality({
    value: destination,
    source: "destination",
  });
  const candidateLocality = resolveAdministrativeLocality({
    value: candidateAddress,
    source: "formatted_address",
    preferredCity: destinationLocality.canonicalCity,
  });
  return { destinationLocality, candidateLocality };
}
