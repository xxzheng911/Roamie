import { useEffect, useRef, useState } from "react";
import { GoogleMap, type MapPlaceMarker, type MapUserLocationPin } from "@/components/GoogleMap";
import { triggerMapResize } from "@/lib/google-maps-loader";
import {
  MAP_PADDING_BOTTOM_DEFAULT,
  applyMapVisiblePadding,
  measureMapExplorePadding,
} from "@/lib/map-visible-padding";

export { MAP_PADDING_BOTTOM_DEFAULT };

type Props = {
  center: { lat: number; lng: number };
  zoom?: number;
  placeMarkers?: MapPlaceMarker[];
  userLocation?: MapUserLocationPin | null;
  onPlaceMarkerClick?: (index: number) => void;
  onLoadError?: (message: string) => void;
  onMapReady?: (map: google.maps.Map) => void;
  onMapClick?: () => void;
};

/**
 * 探索頁唯一的地圖實例容器。
 * 僅能放在 .map-stage 內，不可放入 MapExploreSheet。
 * 地圖 padding.bottom 依 sheet 高度同步，讓 attribution 留在 sheet 上方的地圖安全區。
 */
export function GoogleMapBackground({
  center,
  zoom = 15,
  placeMarkers = [],
  userLocation = null,
  onPlaceMarkerClick,
  onLoadError,
  onMapReady,
  onMapClick,
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const [mapPadding, setMapPadding] = useState(() => measureMapExplorePadding());

  useEffect(() => {
    const stage = stageRef.current;
    const page = stage?.closest(".map-page");
    const sheet = page?.querySelector<HTMLElement>("[data-map-explore-sheet]");
    if (!sheet) return;

    const syncPadding = () => {
      const next = measureMapExplorePadding(sheet);
      setMapPadding(next);
      if (mapInstanceRef.current) {
        applyMapVisiblePadding(mapInstanceRef.current, next);
        triggerMapResize(mapInstanceRef.current);
      }
    };

    syncPadding();
    const ro = new ResizeObserver(syncPadding);
    ro.observe(sheet);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      if (mapInstanceRef.current) {
        triggerMapResize(mapInstanceRef.current);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={stageRef}
      className="map-stage-canvas pointer-events-auto absolute inset-0 z-0 overflow-hidden bg-secondary"
      data-roamie-map-background="true"
    >
      <GoogleMap
        center={center}
        zoom={zoom}
        placeMarkers={placeMarkers}
        userLocation={userLocation}
        onPlaceMarkerClick={onPlaceMarkerClick}
        onLoadError={onLoadError}
        mapPadding={mapPadding}
        onMapClick={onMapClick}
        onMapReady={(map) => {
          mapInstanceRef.current = map;
          onMapReady?.(map);
        }}
        className="h-full w-full"
      />
    </div>
  );
}
