/// <reference types="google.maps" />
import { useCallback, useEffect, useRef, useState } from "react";
import { getGoogleMapsBrowserKeyError } from "@/lib/google-maps-client";
import { loadGoogleMapsApi, triggerMapResize } from "@/lib/google-maps-loader";

const LOG = "[Roamie Maps]";

type Marker = { lat: number; lng: number; title?: string; selected?: boolean };

type Props = {
  center: { lat: number; lng: number };
  zoom?: number;
  markers?: Marker[];
  onMarkerClick?: (index: number) => void;
  className?: string;
  onLoadError?: (message: string) => void;
  onMapReady?: () => void;
};

export function GoogleMap({
  center,
  zoom = 14,
  markers = [],
  onMarkerClick,
  className,
  onLoadError,
  onMapReady,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const centerRef = useRef(center);
  centerRef.current = center;
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const [loadError, setLoadError] = useState<string | null>(() => getGoogleMapsBrowserKeyError());
  const [mapReady, setMapReady] = useState(false);
  const reportedErrorRef = useRef(false);

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
          zoomControl: true,
          gestureHandling: "greedy",
          styles: [
            { featureType: "poi", stylers: [{ visibility: "off" }] },
            { featureType: "transit", stylers: [{ visibility: "off" }] },
          ],
        });
        console.info(LOG, "Map 實例已建立", mapRef.current);
        setMapReady(true);
        onMapReady?.();
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
  }, [zoom, onMapReady, reportError]);

  // Load API + create map when container has size
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
    mapRef.current.setCenter(center);
    console.info(LOG, "panTo center", center);
  }, [center.lat, center.lng, mapReady]);

  useEffect(() => {
    if (!mapRef.current || !window.google?.maps || !mapReady) return;
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = markers.map((m, i) => {
      const marker = new window.google!.maps.Marker({
        position: { lat: m.lat, lng: m.lng },
        map: mapRef.current!,
        title: m.title,
        animation: m.selected ? window.google!.maps.Animation.BOUNCE : undefined,
      });
      if (onMarkerClick) marker.addListener("click", () => onMarkerClick(i));
      return marker;
    });
  }, [markers, onMarkerClick, mapReady]);

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
      className={`h-full min-h-[240px] w-full ${className ?? ""}`}
      aria-label="Google 地圖"
    />
  );
}
