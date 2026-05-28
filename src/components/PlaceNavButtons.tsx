import { Navigation } from "lucide-react";
import { buildDirectionsUrl, buildDirectionsUrlFromQuery, openExternal } from "@/lib/maps-navigation";

type Props = {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  placeName?: string;
  className?: string;
  compact?: boolean;
  /** @deprecated 一律只顯示「查看路線」 */
  routeOnly?: boolean;
};

export function PlaceNavButtons({ lat, lng, address, placeName, className = "", compact }: Props) {
  const hasCoords = lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng);
  const label = placeName ?? address ?? "目的地";
  const navUrl = hasCoords
    ? buildDirectionsUrl({ lat: lat!, lng: lng! })
    : address || label
      ? buildDirectionsUrlFromQuery(address || label)
      : null;

  if (!navUrl) return null;

  const btnClass = compact
    ? "inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[10px]"
    : "inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-border bg-card py-2 text-xs";

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      <button type="button" className={btnClass} onClick={() => openExternal(navUrl)}>
        <Navigation className="h-3 w-3" />
        查看路線
      </button>
    </div>
  );
}
