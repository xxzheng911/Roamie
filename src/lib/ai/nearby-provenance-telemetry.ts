import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";

export type NearbyProvenanceFields = {
  destinationScope?: "primary" | "nearby_extension";
  extensionDestination?: string;
  sourceRegionCandidate?: string;
};

function maskPlaceId(placeId: string | undefined): string {
  const value = placeId?.trim() ?? "";
  if (!value) return "";
  if (value.length <= 8) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 4)}***${value.slice(-3)}`;
}

/** Log only inconsistent/partial nearby metadata, never normal primary places. */
export function logNearbyProvenanceBoundary(params: {
  stage: string;
  placeId?: string;
  provenance: NearbyProvenanceFields;
}): void {
  const { destinationScope, extensionDestination, sourceRegionCandidate } = params.provenance;
  const observed = normalizeDestinationLabel(extensionDestination ?? "");
  const expected = normalizeDestinationLabel(sourceRegionCandidate ?? "");
  const hasAny = Boolean(destinationScope || observed || expected);
  if (!hasAny) return;
  const inconsistent =
    (destinationScope === "nearby_extension" && !observed) ||
    (destinationScope === "primary" && Boolean(observed)) ||
    (Boolean(expected) && destinationScope !== "nearby_extension") ||
    (Boolean(expected) && Boolean(observed) && expected !== observed);
  if (!inconsistent) return;
  logAiPipeline(
    "[NEARBY_PROVENANCE_BOUNDARY]",
    `stage=${params.stage}`,
    `placeIdMasked=${maskPlaceId(params.placeId)}`,
    `destinationScopePresent=${Boolean(destinationScope)}`,
    `extensionDestinationPresent=${Boolean(observed)}`,
    `sourceRegionCandidatePresent=${Boolean(expected)}`,
    `expectedExtension=${expected}`,
    `observedExtension=${observed}`,
  );
}
