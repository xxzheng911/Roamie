import { MapPin, Navigation, Route } from "lucide-react";
import {
  buildDirectionsUrl,
  buildDirectionsUrlFromQuery,
  buildPlaceMapsUrl,
  openExternal,
} from "@/lib/maps-navigation";

type Props = {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  placeName?: string;
  className?: string;
  compact?: boolean;
  /** 僅顯示「查看路線」（開啟 Google Maps 導航） */
  routeOnly?: boolean;
  onAction?: () => void;
};

export function PlaceNavButtons({
  lat,
  lng,
  address,
  placeName,
  className = "",
  compact,
  routeOnly = false,
  onAction,
}: Props) {
  const hasCoords = lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng);
  const label = placeName ?? address ?? "目的地";
  const mapsUrl = hasCoords
    ? buildPlaceMapsUrl(lat!, lng!, label)
    : address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
      : label
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label)}`
        : null;

  const navUrl = hasCoords
    ? buildDirectionsUrl({ lat: lat!, lng: lng! })
    : address || label
      ? buildDirectionsUrlFromQuery(address || label)
      : null;

  if (!mapsUrl && !navUrl) return null;

  const btnClass = compact
    ? "inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[10px]"
    : "inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-border bg-card py-2 text-xs";

  if (routeOnly && navUrl) {
    const routeWrapClass = compact ? className : `w-full ${className}`;
    const routeBtnClass = compact ? btnClass : `${btnClass} w-full justify-center`;
    return (
      <div className={routeWrapClass}>
        <button
          type="button"
          className={routeBtnClass}
          onClick={() => {
            onAction?.();
            openExternal(navUrl);
          }}
        >
          <Route className="h-3.5 w-3.5" />
          查看路線
        </button>
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {mapsUrl && (
        <button type="button" className={btnClass} onClick={() => openExternal(mapsUrl)}>
          <MapPin className="h-3 w-3" />
          Google Maps
        </button>
      )}
      {navUrl && (
        <>
          <button type="button" className={btnClass} onClick={() => openExternal(navUrl)}>
            <Route className="h-3 w-3" />
            查看路線
          </button>
          <button type="button" className={btnClass} onClick={() => openExternal(navUrl)}>
            <Navigation className="h-3 w-3" />
            地圖導航
          </button>
        </>
      )}
    </div>
  );
}
