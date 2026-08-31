import type { DestinationEntityType } from "@/lib/ai/destination-entity";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import type { PlaceResult } from "@/lib/place-result";

export type NearbyGeographicScopeAuthority = {
  source: "clarification_geocode";
  entityType: DestinationEntityType;
  requestedCountry?: string;
  requestedAdministrativeArea?: string;
  requestedLocality?: string;
  requestedDistrict?: string;
  displayLabel: string;
  pendingResume: true;
};

type ParsedAdministrativeAddress = {
  administrativeArea?: string;
  locality?: string;
  district?: string;
};

function canonicalPart(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s,，、.。・-]+/gu, "")
    .trim();
}

/** Parse administrative labels already returned by geocoding / Places; no place-name allowlist. */
export function parseAdministrativeAddress(value: string | null | undefined): ParsedAdministrativeAddress {
  const text = (value ?? "").normalize("NFKC").replace(/^\s*\d{3}(?:-\d{4})?\s*/u, "");
  if (!text) return {};

  const districtMatches = [
    ...text.matchAll(/([\p{Script=Han}\p{Script=Hangul}々ヶケー]{1,30}(?:區|区|구|군))/gu),
  ];
  const districtRaw = districtMatches.at(-1)?.[1];
  const district = districtRaw
    ?.replace(/^.*(?:都|道|府|県|縣|省|市|시)/u, "")
    .trim();

  const beforeDistrict = districtRaw ? text.slice(0, text.lastIndexOf(districtRaw)) + districtRaw : text;
  const localityMatches = [
    ...beforeDistrict.matchAll(/([\p{Script=Han}\p{Script=Hangul}々ヶケー]{1,24}(?:市|시))/gu),
  ];
  const localityRaw = localityMatches.at(-1)?.[1];
  const locality = localityRaw?.replace(/^.*(?:都|道|府|県|縣|省)/u, "").trim();
  const administrativeMatches = [
    ...text.matchAll(/([\p{Script=Han}\p{Script=Hangul}々ヶケー]{1,24}(?:都|道|府|県|縣|省))/gu),
  ];

  return {
    administrativeArea: administrativeMatches.at(-1)?.[1],
    locality,
    district,
  };
}

export function createClarificationGeographicScope(params: {
  entityType: DestinationEntityType;
  displayLabel: string;
  country?: string;
}): NearbyGeographicScopeAuthority {
  const parsed = parseAdministrativeAddress(params.displayLabel);
  return {
    source: "clarification_geocode",
    entityType: params.entityType,
    requestedCountry: params.country?.trim() || undefined,
    requestedAdministrativeArea: parsed.administrativeArea,
    requestedLocality: parsed.locality,
    requestedDistrict: parsed.district,
    displayLabel: params.displayLabel,
    pendingResume: true,
  };
}

export function filterPlacesByNearbyGeographicScope(
  places: PlaceResult[],
  scope: NearbyGeographicScopeAuthority | null | undefined,
): PlaceResult[] {
  if (!scope || scope.entityType !== "district") return places;

  const requestedDistrict = canonicalPart(scope.requestedDistrict);
  logAiPipeline("[NEARBY_GEOGRAPHIC_SCOPE_AUTHORITY]", {
    source: scope.source,
    entityType: scope.entityType,
    requestedCountry: scope.requestedCountry ?? "",
    requestedAdministrativeArea: scope.requestedAdministrativeArea ?? "",
    requestedLocality: scope.requestedLocality ?? "",
    requestedDistrict: scope.requestedDistrict ?? "",
    displayLabel: scope.displayLabel,
    pendingResume: scope.pendingResume,
    enforceable: Boolean(requestedDistrict),
  });
  if (!requestedDistrict) return places;

  const accepted: PlaceResult[] = [];
  for (const place of places) {
    const parsed = parseAdministrativeAddress(place.address);
    const candidateDistrict = canonicalPart(parsed.district);
    const matched = Boolean(candidateDistrict) && candidateDistrict === requestedDistrict;
    const reason = !candidateDistrict
      ? "candidate_district_unknown"
      : matched
        ? "district_exact_match"
        : "district_mismatch";
    logAiPipeline("[NEARBY_CANDIDATE_SCOPE_CHECK]", {
      placeId: place.id,
      placeName: place.name,
      requestedEntityType: scope.entityType,
      requestedDistrict: scope.requestedDistrict ?? "",
      candidateDistrict: parsed.district ?? "",
      candidateLocality: parsed.locality ?? "",
      candidateAdministrativeArea: parsed.administrativeArea ?? "",
      candidateAddress: place.address ?? "",
      match: matched,
      reason,
    });
    if (matched) {
      accepted.push(place);
    } else {
      logAiPipeline("[NEARBY_CANDIDATE_SCOPE_REJECTED]", {
        placeId: place.id,
        placeName: place.name,
        requestedDistrict: scope.requestedDistrict ?? "",
        candidateDistrict: parsed.district ?? "",
        reason: candidateDistrict ? "district_mismatch" : "geographic_metadata_missing",
      });
    }
  }
  logAiPipeline("[NEARBY_SCOPE_FILTER_SUMMARY]", {
    requestedEntityType: scope.entityType,
    requestedDistrict: scope.requestedDistrict ?? "",
    inputCount: places.length,
    matchedCount: accepted.length,
    mismatchCount: places.filter((place) => Boolean(parseAdministrativeAddress(place.address).district))
      .length - accepted.length,
    unknownCount: places.filter((place) => !parseAdministrativeAddress(place.address).district)
      .length,
  });
  return accepted;
}
