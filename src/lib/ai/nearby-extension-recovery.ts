import type { ChatPlaceItem } from "@/lib/chat-session";
import { isMappableGooglePlaceId } from "@/lib/ai/map-named-places-to-google";
import { isValidItineraryStopPlace } from "@/lib/ai/generic-place-label";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import type { RegionCandidateFetchSignal } from "@/lib/ai/region-candidate-expand";

export type NearbyRecoverySource = {
  name: string;
  places: readonly ChatPlaceItem[];
};

export type NearbyRecoveryEvidence = "provenance" | "source_region" | "text_fallback";

export type NearbyRecoveryCandidate = {
  place: ChatPlaceItem;
  source: string;
  evidence: NearbyRecoveryEvidence;
};

export type NearbyRecoveryReject = { place: ChatPlaceItem; source: string; reason: string };

export function isNearbyRecoverySignal(signal: RegionCandidateFetchSignal): boolean {
  return (
    signal === "global_rate_protection" ||
    signal === "request_cooldown" ||
    signal === "query_cooldown"
  );
}

function nearbyEvidence(place: ChatPlaceItem, extension: string): NearbyRecoveryEvidence | null {
  const target = normalizeDestinationLabel(extension);
  const tagged = normalizeDestinationLabel(place.extensionDestination ?? "");
  if (place.destinationScope === "nearby_extension" && tagged === target) return "provenance";
  const sourceRegion = normalizeDestinationLabel(place.sourceRegionCandidate ?? "");
  if (sourceRegion === target) return "source_region";
  if (place.destinationScope === "primary") return null;
  const blob = [place.placeName, place.name, place.address].filter(Boolean).join(" ").toLowerCase();
  return target && blob.includes(target.toLowerCase()) ? "text_fallback" : null;
}

export function recoverNearbyExtensionCandidates(params: {
  extension: string;
  sources: readonly NearbyRecoverySource[];
}): {
  candidates: NearbyRecoveryCandidate[];
  rejected: NearbyRecoveryReject[];
  matchedBeforeDedupe: number;
} {
  const byId = new Map<string, NearbyRecoveryCandidate>();
  const rejected: NearbyRecoveryReject[] = [];
  let matchedBeforeDedupe = 0;
  for (const source of params.sources) {
    for (const place of source.places) {
      const evidence = nearbyEvidence(place, params.extension);
      if (!evidence) continue;
      matchedBeforeDedupe += 1;
      const id = (place.googlePlaceId ?? place.placeId ?? "").trim();
      let reason = "";
      if (!isMappableGooglePlaceId(id)) reason = "invalid_place_id";
      else if (
        place.lat == null ||
        place.lng == null ||
        !Number.isFinite(place.lat) ||
        !Number.isFinite(place.lng)
      ) {
        reason = "invalid_coordinates";
      } else if (!isValidItineraryStopPlace(place, params.extension)) reason = "invalid_place";
      else if ((place.businessStatus ?? "").toUpperCase() === "CLOSED_PERMANENTLY") {
        reason = "closed_permanently";
      }
      if (reason) {
        rejected.push({ place, source: source.name, reason });
        continue;
      }
      if (byId.has(id)) continue;
      byId.set(id, {
        source: source.name,
        evidence,
        place: {
          ...place,
          googlePlaceId: id,
          placeId: id,
          destinationScope: "nearby_extension",
          extensionDestination: normalizeDestinationLabel(params.extension),
          sourceRegionCandidate:
            place.sourceRegionCandidate ?? normalizeDestinationLabel(params.extension),
        },
      });
    }
  }
  return { candidates: [...byId.values()], rejected, matchedBeforeDedupe };
}
