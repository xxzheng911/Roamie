import { isDiagnosticsModeEnabled } from "@/lib/debug/recommendation-diagnostics";

type Props = {
  dataSource?: string | null;
  imageSource?: string | null;
  verified?: string | null;
  openingHoursSource?: string | null;
  placeId?: string | null;
  fallbackReason?: string | null;
  recommendationSource?: string | null;
  nearbyPlacesSource?: string | null;
  aiFallbackSource?: string | null;
};

export function RecommendationDebugPanel({
  dataSource,
  imageSource,
  verified,
  openingHoursSource,
  placeId,
  fallbackReason,
  recommendationSource,
  nearbyPlacesSource,
  aiFallbackSource,
}: Props) {
  if (!isDiagnosticsModeEnabled()) return null;

  const rows = [
    ["data", dataSource],
    ["image", imageSource],
    ["verified", verified],
    ["hours", openingHoursSource],
    ["place_id", placeId],
    ["fallback", fallbackReason],
    ["rec_source", recommendationSource],
    ["nearby_source", nearbyPlacesSource],
    ["ai_fallback", aiFallbackSource],
  ].filter(([, value]) => Boolean(value?.trim()));

  if (rows.length === 0) return null;

  return (
    <div className="mt-2 rounded-lg border border-amber-300/80 bg-amber-50/90 px-2 py-1.5 text-[10px] leading-tight text-amber-950/90">
      {rows.map(([label, value]) => (
        <p key={label}>
          <span className="font-semibold">{label}:</span> {value}
        </p>
      ))}
    </div>
  );
}
