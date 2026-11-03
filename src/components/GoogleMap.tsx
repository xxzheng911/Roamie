import { useI18n } from "@/hooks/use-i18n";
/// <reference types="google.maps" />
import { useCallback, useEffect, useRef, useState } from "react";
import { getGoogleMapsBrowserKeyError } from "@/lib/google-maps-client";
import { logMapsOnce } from "@/lib/google-maps-init-log";
import {
  isGoogleMapsNetworkError,
  loadGoogleMapsApi,
  triggerMapResize,
} from "@/lib/google-maps-loader";
import {
  createRoamieUserLocationOverlay,
  ROAMIE_USER_LOCATION_LABEL,
  type UserLocationOverlayHandle,
} from "@/components/map/RoamieUserLocationOverlay";
import {
  isGoogleMapsOverlayReady,
  resolveUserMarkerAvatarSrc,
} from "@/lib/map-user-location-marker";
import { applyMapVisiblePadding, type MapVisiblePadding } from "@/lib/map-visible-padding";
import { markerSnapshotKey } from "@/lib/map-marker-snapshot";

const LOG = "[Roamie Maps]";

export type MapPlaceMarker = {
  id?: string;
  lat: number;
  lng: number;
  title?: string;
  selected?: boolean;
  /** 選填：Pin 上的文字（例如天數或站序）；有 label／color／variant 任一時改用 SVG Symbol 圓形 Pin */
  label?: string;
  /** 選填：Pin 主色（CSS 色碼） */
  color?: string;
  /** 選填：solid＝實心；outline＝白底描邊（預設 solid） */
  variant?: "solid" | "outline";
  /** 選填：覆寫 zIndex（未提供時沿用 selected 500／100） */
  zIndex?: number;
};

/** 選填折線（直線依序連接，虛線樣式） */
export type MapPolyline = {
  id: string;
  color: string;
  path: Array<{ lat: number; lng: number }>;
};

/** 選填視野：單點置中＋縮放，或 fitBounds */
export type MapFitTarget =
  | { type: "point"; center: { lat: number; lng: number }; zoom: number }
  | { type: "bounds"; bounds: { north: number; south: number; east: number; west: number } };

function isStyledMarker(item: MapPlaceMarker): boolean {
  return item.label != null || item.color != null || item.variant != null;
}

function styledMarkerSignature(item: MapPlaceMarker): string {
  return isStyledMarker(item)
    ? `${item.label ?? ""}|${item.color ?? ""}|${item.variant ?? ""}|${item.zIndex ?? ""}`
    : "";
}

function styledMarkerIcon(g: typeof google.maps, item: MapPlaceMarker): google.maps.Symbol {
  const color = item.color ?? "#5c5348";
  const solid = item.variant !== "outline";
  return {
    path: g.SymbolPath.CIRCLE,
    scale: 12,
    fillColor: solid ? color : "#ffffff",
    fillOpacity: 1,
    strokeColor: solid ? "#ffffff" : color,
    strokeWeight: solid ? 2 : 2.5,
  };
}

function styledMarkerLabel(item: MapPlaceMarker): google.maps.MarkerLabel | undefined {
  if (!item.label) return undefined;
  const solid = item.variant !== "outline";
  return {
    text: item.label,
    color: solid ? "#ffffff" : (item.color ?? "#5c5348"),
    fontSize: "12px",
    fontWeight: "600",
  };
}

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
  onUserCenterChange?: (center: { lat: number; lng: number }) => void;
  /** 選填：依序直線虛線（未傳時不建立任何折線） */
  polylines?: MapPolyline[];
  /** 選填：地圖手勢模式（僅建立地圖時套用；預設 greedy） */
  gestureHandling?: "greedy" | "cooperative" | "none" | "auto";
  /** 選填：物件參照改變時套用一次視野（未傳／null 時不調整視野） */
  fitToMarkers?: MapFitTarget | null;
  /**
   * 選填：容器是否可見（例如所在分頁被 display:none 隱藏時傳 false）。
   * 由 false 變 true 時觸發 resize，並補套隱藏期間延後的 fitToMarkers。未傳＝恆可見（行為不變）。
   */
  visible?: boolean;
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
  onUserCenterChange,
  polylines,
  gestureHandling = "greedy",
  fitToMarkers,
  visible,
}: Props) {
  const { t: uiT } = useI18n();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const centerRef = useRef(center);
  centerRef.current = center;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const onMapReadyRef = useRef(onMapReady);
  onMapReadyRef.current = onMapReady;
  const mapPaddingRef = useRef(mapPadding);
  mapPaddingRef.current = mapPadding;
  const gestureHandlingRef = useRef(gestureHandling);
  gestureHandlingRef.current = gestureHandling;
  const polylineRecordsRef = useRef<google.maps.Polyline[]>([]);
  const mapRef = useRef<google.maps.Map | null>(null);
  const initStartedRef = useRef(false);
  const markerRecordsRef = useRef<
    Array<{ key: string; marker: google.maps.Marker; selected: boolean; style: string }>
  >([]);
  const placeMarkersPropRef = useRef(placeMarkers);
  placeMarkersPropRef.current = placeMarkers;
  const onPlaceMarkerClickRef = useRef(onPlaceMarkerClick);
  onPlaceMarkerClickRef.current = onPlaceMarkerClick;
  const userOverlayRef = useRef<UserLocationOverlayHandle | null>(null);
  const userInfoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const userLocationRef = useRef(userLocation);
  userLocationRef.current = userLocation;
  const [loadError, setLoadError] = useState<string | null>(() => getGoogleMapsBrowserKeyError());
  const [mapReady, setMapReady] = useState(false);
  const reportedErrorRef = useRef(false);
  const isVisible = visible !== false;
  /** 最近一次可見後是否已完成 resize（隱藏時設 false） */
  const sizedWhileVisibleRef = useRef(isVisible);
  const appliedFitRef = useRef<MapFitTarget | null>(null);

  const openUserLocationInfo = useCallback(() => {
    const map = mapRef.current;
    const loc = userLocationRef.current;
    const iw = userInfoWindowRef.current;
    if (!map || !loc || !iw) return;
    iw.setPosition({ lat: loc.lat, lng: loc.lng });
    iw.open({ map });
  }, []);

  const reportError = useCallback(
    (message: string, recoverable = false) => {
      if (!recoverable) console.error(LOG, message);
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
      logMapsOnce("container-mounted", "map container mounted", {
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
      logMapsOnce("initialize-start", "initializeMap 開始", {
        center: centerRef.current,
        zoom: zoomRef.current,
        size: rect,
      });
      const maps = await loadGoogleMapsApi();
      logMapsOnce("api-ready", "API 就緒", {
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
          zoom: zoomRef.current,
          disableDefaultUI: true,
          zoomControl: false,
          fullscreenControl: false,
          streetViewControl: false,
          mapTypeControl: false,
          keyboardShortcuts: false,
          gestureHandling: gestureHandlingRef.current,
          styles: [
            { featureType: "poi", stylers: [{ visibility: "off" }] },
            { featureType: "transit", stylers: [{ visibility: "off" }] },
          ],
        });
        logMapsOnce("map-instance-created", "Map 實例已建立");
        const padding = mapPaddingRef.current;
        if (padding) {
          applyMapVisiblePadding(mapRef.current, padding);
        }
        userInfoWindowRef.current = new maps.InfoWindow({
          content: `<div style="font-size:13px;padding:4px 2px;font-family:system-ui,sans-serif;color:#5c5348;">${ROAMIE_USER_LOCATION_LABEL}</div>`,
        });
        setMapReady(true);
        onMapReadyRef.current?.(mapRef.current);
        requestAnimationFrame(() => {
          if (mapRef.current) triggerMapResize(mapRef.current);
        });
      }
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "無法載入 Google 地圖";
      reportError(msg, isGoogleMapsNetworkError(e));
      return true;
    }
  }, [reportError]);

  useEffect(() => {
    if (!mapRef.current || !mapReady || !mapPadding) return;
    applyMapVisiblePadding(mapRef.current, mapPadding);
    triggerMapResize(mapRef.current);
  }, [mapPadding, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !onUserCenterChange) return;
    const listener = map.addListener("dragend", () => {
      const center = map.getCenter();
      if (center) onUserCenterChange({ lat: center.lat(), lng: center.lng() });
    });
    return () => listener.remove();
  }, [mapReady, onUserCenterChange]);

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

    if (initStartedRef.current && mapRef.current) {
      return;
    }
    initStartedRef.current = true;

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
    logMapsOnce(`pan-${center.lat}-${center.lng}-${zoom}`, "panTo center", { center, zoom });
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
    const map = mapRef.current;
    const existingByKey = new Map(markerRecordsRef.current.map((record) => [record.key, record]));
    const next: Array<{
      key: string;
      marker: google.maps.Marker;
      selected: boolean;
      style: string;
    }> = [];
    const seen = new Set<string>();

    try {
      for (const item of placeMarkers) {
        const key = markerSnapshotKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        const selected = Boolean(item.selected);
        // 未帶 label／color／variant／zIndex 的 marker：style 為 ""，行為與既有完全相同。
        const style = styledMarkerSignature(item);
        const found = existingByKey.get(key);
        if (found) {
          existingByKey.delete(key);
          const position = found.marker.getPosition();
          if (!position || position.lat() !== item.lat || position.lng() !== item.lng) {
            found.marker.setPosition({ lat: item.lat, lng: item.lng });
          }
          if ((found.marker.getTitle() ?? "") !== (item.title ?? "")) found.marker.setTitle(item.title ?? "");
          if (found.selected !== selected) {
            found.marker.setAnimation(selected ? (g.Animation?.BOUNCE ?? null) : null);
            found.marker.setZIndex(item.zIndex ?? (selected ? 500 : 100));
            found.selected = selected;
          }
          if (found.style !== style) {
            if (isStyledMarker(item)) {
              found.marker.setIcon(styledMarkerIcon(g, item));
              found.marker.setLabel(styledMarkerLabel(item) ?? null);
            }
            found.marker.setZIndex(item.zIndex ?? (selected ? 500 : 100));
            found.style = style;
          }
          next.push(found);
          continue;
        }
        const styled = isStyledMarker(item);
        const marker = new g.Marker({
          position: { lat: item.lat, lng: item.lng },
          map,
          title: item.title,
          animation: selected ? g.Animation?.BOUNCE : undefined,
          zIndex: item.zIndex ?? (selected ? 500 : 100),
          ...(styled ? { icon: styledMarkerIcon(g, item), label: styledMarkerLabel(item) } : {}),
        });
        marker.addListener("click", () => {
          const index = placeMarkersPropRef.current.findIndex(
            (candidate) => markerSnapshotKey(candidate) === key,
          );
          if (index >= 0) onPlaceMarkerClickRef.current?.(index);
        });
        next.push({ key, marker, selected, style });
      }
      for (const leftover of existingByKey.values()) {
        try {
          leftover.marker.setMap(null);
        } catch {
          /* ignore */
        }
      }
      markerRecordsRef.current = next;
    } catch (e) {
      console.warn(LOG, "建立地圖標記失敗", e);
    }
  }, [placeMarkers, mapReady]);

  // 選填折線：未傳 polylines 且未曾建立時不做任何事（探索頁行為不變）。
  useEffect(() => {
    if (!mapRef.current || !mapReady) return;
    if (!polylines && polylineRecordsRef.current.length === 0) return;
    const g = window.google?.maps;
    if (!g?.Polyline) return;
    for (const line of polylineRecordsRef.current) {
      try {
        line.setMap(null);
      } catch {
        /* ignore */
      }
    }
    polylineRecordsRef.current = [];
    try {
      for (const line of polylines ?? []) {
        if (line.path.length < 2) continue;
        polylineRecordsRef.current.push(
          new g.Polyline({
            map: mapRef.current,
            path: line.path,
            geodesic: false,
            clickable: false,
            strokeOpacity: 0,
            zIndex: 10,
            icons: [
              {
                icon: {
                  path: "M 0,-1 0,1",
                  strokeOpacity: 0.85,
                  strokeColor: line.color,
                  strokeWeight: 2.5,
                  scale: 2.5,
                },
                offset: "0",
                repeat: "12px",
              },
            ],
          }),
        );
      }
    } catch (e) {
      console.warn(LOG, "建立地圖折線失敗", e);
    }
  }, [polylines, mapReady]);

  useEffect(() => {
    return () => {
      for (const line of polylineRecordsRef.current) {
        try {
          line.setMap(null);
        } catch {
          /* ignore */
        }
      }
      polylineRecordsRef.current = [];
    };
  }, []);

  // 選填視野：fitToMarkers 物件參照改變時套用一次（未傳／null 時不調整，探索頁行為不變）。
  // visible === false（容器被隱藏）時延後；再次可見時先 resize，等版面穩定（兩個 frame）後補套。
  // 未傳 visible 時 isVisible 恆為 true、sizedWhileVisibleRef 恆為 true → 與原本同步套用完全相同。
  useEffect(() => {
    if (!isVisible) {
      sizedWhileVisibleRef.current = false;
      return;
    }
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const target = fitToMarkers;
    const applyFit = () => {
      if (!target || appliedFitRef.current === target) return;
      appliedFitRef.current = target;
      if (target.type === "point") {
        map.setCenter(target.center);
        map.setZoom(target.zoom);
        return;
      }
      const { north, south, east, west } = target.bounds;
      if (north === south && east === west) {
        map.setCenter({ lat: north, lng: east });
        map.setZoom(15);
        return;
      }
      map.fitBounds({ north, south, east, west }, 56);
    };
    if (sizedWhileVisibleRef.current) {
      applyFit();
      return;
    }
    triggerMapResize(map);
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        sizedWhileVisibleRef.current = true;
        triggerMapResize(map);
        applyFit();
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [fitToMarkers, mapReady, isVisible]);

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
      aria-label={uiT("productionUi.p0ef775348c")}
    />
  );
}
