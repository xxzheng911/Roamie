/// <reference types="google.maps" />
import { useCallback, useEffect, useRef, useState } from "react";
import { getGoogleMapsBrowserKeyError } from "@/lib/google-maps-client";
import { loadGoogleMapsApi, triggerMapResize } from "@/lib/google-maps-loader";
import {
  createRoamieUserLocationOverlay,
  ROAMIE_USER_LOCATION_LABEL,
  type UserLocationOverlayHandle,
} from "@/components/map/RoamieUserLocationOverlay";
import {
  isGoogleMapsOverlayReady,
  resolveUserMarkerAvatarSrc,
} from "@/lib/map-user-location-marker";
import {
  applyMapVisiblePadding,
  type MapVisiblePadding,
} from "@/lib/map-visible-padding";

const LOG = "[Roamie Maps]";

export type MapPlaceMarker = {
  lat: number;
  lng: number;
  title?: string;
  selected?: boolean;
};

export type MapUserLocationPin = {
  lat: number;
  lng: number;
  /** 已解析的大頭貼（自訂或 Roamie 預設插畫） */
  avatarSrc: string;
};

type Props = {
  center: { lat: number; lng: number };
  zoom?: number;
  placeMarkers?: MapPlaceMarker[];
  userLocation?: MapUserLocationPin | null;
  onPlaceMarkerClick?: (index: number) => void;
  className?: string;
  onLoadError?: (message: string) => void;
  onMapReady?: (map: google.maps.Map) => void;
  /** 為 sheet / bottom nav / 搜尋列保留的可視區 padding */
  mapPadding?: MapVisiblePadding;
  /** 點擊地圖空白區（不含 marker） */
  onMapClick?: () => void;
};

export function GoogleMap({
  center,
  zoom = 14,
  placeMarkers = [],
  userLocation = null,
  onPlaceMarkerClick,
  className,
  onLoadError,
  onMapReady,
  mapPadding,
  onMapClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const centerRef = useRef(center);
  centerRef.current = center;
  const mapRef = useRef<google.maps.Map | null>(null);
  const placeMarkersRef = useRef<google.maps.Marker[]>([]);
  const userOverlayRef = useRef<UserLocationOverlayHandle | null>(null);
  const userInfoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const userLocationRef = useRef(userLocation);
  userLocationRef.current = userLocation;
  const [loadError, setLoadError] = useState<string | null>(() => getGoogleMapsBrowserKeyError());
  const [mapReady, setMapReady] = useState(false);
  const reportedErrorRef = useRef(false);

  const openUserLocationInfo = useCallback(() => {
    const map = mapRef.current;
    const loc = userLocationRef.current;
    const iw = userInfoWindowRef.current;
    if (!map || !loc || !iw) return;
    iw.setPosition({ lat: loc.lat, lng: loc.lng });
    iw.open({ map });
  }, []);

  const reportError = useCallback(
    (message: string) => {
      console.error(LOG, message);
      setLoadError(message);
      if (!reportedErrorRef.current) {
        reportedErrorRef.current = true;
        onLoadError?.(message);
      }
    },
    [onLoadError],
  );

  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node;
    if (node) {
      const rect = node.getBoundingClientRect();
      console.info(LOG, "map container mounted", {
        width: rect.width,
        height: rect.height,
      });
    }
  }, []);

  const initializeMap = useCallback(async () => {
    const el = containerRef.current;
    if (!el) {
      reportError("地圖容器尚未掛載（ref 為 null）");
      return;
    }

    const rect = el.getBoundingClientRect();
    if (rect.height < 8 || rect.width < 8) {
      console.warn(LOG, "容器尺寸過小，延後初始化", rect);
      return false;
    }

    try {
      console.info(LOG, "initializeMap 開始", { center: centerRef.current, zoom, size: rect });
      const maps = await loadGoogleMapsApi();
      console.info(LOG, "API 就緒", {
        hasMapCtor: typeof maps.Map === "function",
        hasMarkerCtor: typeof maps.Marker === "function",
      });

      if (!containerRef.current) {
        reportError("初始化時地圖容器已卸載");
        return true;
      }

      if (!mapRef.current) {
        mapRef.current = new maps.Map(containerRef.current, {
          center: centerRef.current,
          zoom,
          disableDefaultUI: true,
          zoomControl: false,
          fullscreenControl: false,
          streetViewControl: false,
          mapTypeControl: false,
          keyboardShortcuts: false,
          gestureHandling: "greedy",
          styles: [
            { featureType: "poi", stylers: [{ visibility: "off" }] },
            { featureType: "transit", stylers: [{ visibility: "off" }] },
          ],
        });
        console.info(LOG, "Map 實例已建立", mapRef.current);
        if (mapPadding) {
          applyMapVisiblePadding(mapRef.current, mapPadding);
        }
        userInfoWindowRef.current = new maps.InfoWindow({
          content: `<div style="font-size:13px;padding:4px 2px;font-family:system-ui,sans-serif;color:#5c5348;">${ROAMIE_USER_LOCATION_LABEL}</div>`,
        });
        setMapReady(true);
        onMapReady?.(mapRef.current);
        requestAnimationFrame(() => {
          if (mapRef.current) triggerMapResize(mapRef.current);
        });
      }
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "無法載入 Google 地圖";
      reportError(msg);
      return true;
    }
  }, [zoom, onMapReady, mapPadding, reportError]);

  useEffect(() => {
    if (!mapRef.current || !mapReady || !mapPadding) return;
    applyMapVisiblePadding(mapRef.current, mapPadding);
    triggerMapResize(mapRef.current);
  }, [mapPadding, mapReady]);

  useEffect(() => {
    if (!mapRef.current || !mapReady || !onMapClick) return;
    const g = window.google?.maps;
    if (!g?.event) return;
    const listener = mapRef.current.addListener("click", () => onMapClick());
    return () => {
      g.event.removeListener(listener);
    };
  }, [mapReady, onMapClick]);

  useEffect(() => {
    let cancelled = false;
    const keyError = getGoogleMapsBrowserKeyError();
    if (keyError) {
      reportError(keyError);
      return;
    }

    let attempts = 0;
    const maxAttempts = 40;

    const tryInit = async () => {
      if (cancelled || mapRef.current) return;
      attempts += 1;
      const done = await initializeMap();
      if (cancelled || done) return;
      if (attempts < maxAttempts) {
        requestAnimationFrame(tryInit);
      } else {
        reportError("地圖容器高度為 0 或過小，無法初始化。請檢查版面配置。");
      }
    };

    tryInit();

    const onResize = () => {
      if (mapRef.current) triggerMapResize(mapRef.current);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
    };
  }, [initializeMap, reportError]);

  useEffect(() => {
    if (!mapRef.current || !mapReady) return;
    mapRef.current.panTo(center);
    if (zoom != null) mapRef.current.setZoom(zoom);
    console.info(LOG, "panTo center", center, "zoom", zoom);
  }, [center.lat, center.lng, zoom, mapReady]);

  useEffect(() => {
    if (!mapRef.current || !mapReady || !isGoogleMapsOverlayReady()) return;

    if (!userLocation) {
      try {
        userOverlayRef.current?.setMap(null);
      } catch {
        /* ignore */
      }
      userOverlayRef.current = null;
      return;
    }

    const position = { lat: userLocation.lat, lng: userLocation.lng };
    const avatarSrc = resolveUserMarkerAvatarSrc(userLocation.avatarSrc);

    if (!userOverlayRef.current) {
      const overlay = createRoamieUserLocationOverlay(position, {
        avatarSrc,
        onClick: openUserLocationInfo,
      });
      if (!overlay) return;
      try {
        overlay.setMap(mapRef.current);
        userOverlayRef.current = overlay;
      } catch (e) {
        console.warn(LOG, "掛載使用者定位 overlay 失敗", e);
        userOverlayRef.current = null;
      }
      return;
    }

    try {
      userOverlayRef.current.update(position, avatarSrc);
    } catch (e) {
      console.warn(LOG, "更新使用者定位 overlay 失敗", e);
      try {
        userOverlayRef.current.setMap(null);
      } catch {
        /* ignore */
      }
      userOverlayRef.current = null;
    }
  }, [userLocation, mapReady, openUserLocationInfo]);

  useEffect(() => {
    return () => {
      try {
        userOverlayRef.current?.setMap(null);
      } catch {
        /* ignore */
      }
      userOverlayRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !mapReady) return;
    const g = window.google?.maps;
    if (!g?.Marker) return;

    placeMarkersRef.current.forEach((m) => {
      try {
        m.setMap(null);
      } catch {
        /* ignore */
      }
    });
    placeMarkersRef.current = [];

    try {
      const MarkerCtor = g.Marker;
      placeMarkersRef.current = placeMarkers.map((m, i) => {
        const marker = new MarkerCtor({
          position: { lat: m.lat, lng: m.lng },
          map: mapRef.current!,
          title: m.title,
          animation: m.selected ? g.Animation?.BOUNCE : undefined,
          zIndex: m.selected ? 500 : 100,
        });
        if (onPlaceMarkerClick) marker.addListener("click", () => onPlaceMarkerClick(i));
        return marker;
      });
    } catch (e) {
      console.warn(LOG, "建立地圖標記失敗", e);
    }
  }, [placeMarkers, onPlaceMarkerClick, mapReady]);

  if (loadError) {
    return (
      <div
        className={`flex min-h-[240px] w-full items-center justify-center bg-secondary px-6 text-center ${className ?? ""}`}
      >
        <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">{loadError}</p>
      </div>
    );
  }

  return (
    <div
      ref={setContainerRef}
      className={`relative z-0 h-full min-h-[240px] w-full overflow-hidden ${className ?? ""}`}
      aria-label="Google 地圖"
    />
  );
}
