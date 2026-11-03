/// <reference types="google.maps" />
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, MapPin, X } from "lucide-react";
import {
  GoogleMap,
  type MapFitTarget,
  type MapPlaceMarker,
  type MapPolyline,
} from "@/components/GoogleMap";
import type { RoamieItineraryItem } from "@/lib/ai/types";
import {
  formatTripWorkspaceCount,
  formatTripWorkspaceTemplate,
  type TripWorkspaceCopy,
} from "@/lib/i18n/trip-workspace-copy";
import type { TripDayGroup } from "@/lib/trip/trip-day-groups";
import {
  buildTripMapMarkers,
  dayColor,
  isLocatedCoordinate,
  tripMapItemTitle,
  type TripMapMarker,
  type TripMapMode,
} from "@/lib/trip/trip-map-markers";

/**
 * Google Maps 的 Symbol／Polyline 色彩只保證支援 CSS3 色碼，
 * 天數色票為 oklch()，此處轉成 sRGB hex；無法解析時原樣回傳。
 */
function oklchToHex(css: string): string {
  const m = css.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*\)$/i);
  if (!m) return css;
  const L = m[2] ? Number(m[1]) / 100 : Number(m[1]);
  const C = Number(m[3]);
  const h = (Number(m[4]) * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ];
  const hex = linear
    .map((x) => {
      const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
      const n = Math.round(Math.min(1, Math.max(0, v)) * 255);
      return n.toString(16).padStart(2, "0");
    })
    .join("");
  return `#${hex}`;
}

const MAP_ZOOM_DEFAULT = 14;
const MAP_ZOOM_DESTINATION = 11;
const ALL_MODE: TripMapMode = { kind: "all" };

export type TripWorkspaceMapState = { mode: TripMapMode; selectedId: string | null };

type Props = {
  /** 目前行程狀態（含本地編輯與 Realtime）的天數分組 */
  dayGroups: TripDayGroup[];
  /** 地圖分頁是否為目前分頁（隱藏時不調整視野） */
  active: boolean;
  copy: TripWorkspaceCopy;
  /** 已存的目的地座標（不查詢）；所有地點皆無座標時用來置中 */
  destination: { lat: number; lng: number } | null;
  /** 從地點詳情返回時還原的模式與選取 */
  initialState?: TripWorkspaceMapState | null;
  /** dayIndex：Pin 所屬天（0-based），詳情頁的前一站與返回天數都以此為準 */
  onOpenDetail: (item: RoamieItineraryItem, state: TripWorkspaceMapState, dayIndex: number) => void;
  /** 切回行程分頁的某一天（0-based dayIndex） */
  onGoToDay: (dayIndex: number) => void;
  /**
   * 版面（選填）："pane"＝iPhone Duo 雙欄右欄，地圖填滿欄高。
   * 未傳時為 "inline"（分頁內），輸出與修改前相同。
   */
  layout?: "inline" | "pane";
};

type UnlocatedEntry = {
  key: string;
  dayIndex: number;
  dayNumber: number;
  stopNumber: number;
  title: string;
};

export function TripWorkspaceMap({
  dayGroups,
  active,
  copy,
  destination,
  initialState,
  onOpenDetail,
  onGoToDay,
  layout = "inline",
}: Props) {
  const paneLayout = layout === "pane";
  const scheduled = useMemo(() => dayGroups.filter((g) => g.isUnassigned !== true), [dayGroups]);
  const [mode, setMode] = useState<TripMapMode>(() => initialState?.mode ?? ALL_MODE);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => initialState?.selectedId ?? null,
  );
  const [unlocatedOpen, setUnlocatedOpen] = useState(false);

  // 該天被刪除時回到「全部」
  const effectiveMode = useMemo<TripMapMode>(
    () =>
      mode.kind === "day" && !scheduled.some((g) => g.dayNumber === mode.dayIndex + 1)
        ? ALL_MODE
        : mode,
    [mode, scheduled],
  );

  const result = useMemo(
    () => buildTripMapMarkers(dayGroups, effectiveMode),
    [dayGroups, effectiveMode],
  );
  const hasAnyLocated = useMemo(
    () => buildTripMapMarkers(dayGroups, ALL_MODE).markers.length > 0,
    [dayGroups],
  );

  const selected = useMemo(
    () => result.markers.find((m) => m.id === selectedId) ?? null,
    [result.markers, selectedId],
  );
  const selectedIndex = selected ? result.markers.indexOf(selected) : -1;
  const selectedItem: RoamieItineraryItem | null = useMemo(() => {
    if (!selected) return null;
    const group = scheduled.find((g) => g.dayNumber === selected.dayNumber);
    return group?.items[selected.itemIndexInDay] ?? null;
  }, [selected, scheduled]);

  const placeMarkers = useMemo<MapPlaceMarker[]>(
    () =>
      result.markers.map((m, i) => ({
        id: m.id,
        lat: m.lat,
        lng: m.lng,
        title: m.title,
        label: m.label,
        color: oklchToHex(m.color),
        variant: m.variant,
        zIndex: m.id === selectedId ? 1000 : 200 + i,
      })),
    [result.markers, selectedId],
  );
  const polylines = useMemo<MapPolyline[]>(
    () =>
      result.polylines.map((p) => ({
        id: `d${p.dayIndex}`,
        color: oklchToHex(p.color),
        path: p.path,
      })),
    [result.polylines],
  );

  // 視野：只在地圖分頁顯示中、且視野目標改變時套用一次
  const fitSignature = JSON.stringify(result.fit);
  const [fitRequest, setFitRequest] = useState<MapFitTarget | null>(null);
  const appliedFitRef = useRef<string | null>(null);
  useEffect(() => {
    if (!active || appliedFitRef.current === fitSignature) return;
    appliedFitRef.current = fitSignature;
    setFitRequest(result.fit ? { ...result.fit } : null);
    // result.fit 由 fitSignature 代表
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, fitSignature]);

  // 地圖初始中心：第一次可用的視野中心或目的地（之後由 fitRequest 調整）
  const initialCenterRef = useRef<{ center: { lat: number; lng: number }; zoom: number } | null>(
    null,
  );
  if (!initialCenterRef.current) {
    const fit = result.fit;
    if (fit?.type === "point") {
      initialCenterRef.current = { center: fit.center, zoom: fit.zoom };
    } else if (fit?.type === "bounds") {
      initialCenterRef.current = {
        center: {
          lat: (fit.bounds.north + fit.bounds.south) / 2,
          lng: (fit.bounds.east + fit.bounds.west) / 2,
        },
        zoom: MAP_ZOOM_DEFAULT,
      };
    } else if (destination && isLocatedCoordinate(destination.lat, destination.lng)) {
      initialCenterRef.current = { center: destination, zoom: MAP_ZOOM_DESTINATION };
    }
  }
  const initialCenter = initialCenterRef.current;

  const mapRef = useRef<google.maps.Map | null>(null);
  const handleMapReady = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  const selectMarker = useCallback((marker: TripMapMarker | null, pan: boolean) => {
    setSelectedId(marker?.id ?? null);
    if (marker && pan) mapRef.current?.panTo({ lat: marker.lat, lng: marker.lng });
  }, []);

  const markersRef = useRef(result.markers);
  markersRef.current = result.markers;
  const handleMarkerClick = useCallback(
    (index: number) => selectMarker(markersRef.current[index] ?? null, false),
    [selectMarker],
  );
  const handleMapClick = useCallback(() => setSelectedId(null), []);

  const changeMode = (next: TripMapMode) => {
    setMode(next);
    setSelectedId(null);
    setUnlocatedOpen(false);
  };

  const unlocated = useMemo<UnlocatedEntry[]>(() => {
    const out: UnlocatedEntry[] = [];
    for (const g of scheduled) {
      const dayIndex = g.dayNumber - 1;
      if (effectiveMode.kind === "day" && effectiveMode.dayIndex !== dayIndex) continue;
      g.items.forEach((item, i) => {
        if (isLocatedCoordinate(item.lat, item.lng)) return;
        out.push({
          key: `${g.dateKey}:${i}`,
          dayIndex,
          dayNumber: g.dayNumber,
          stopNumber: i + 1,
          title: tripMapItemTitle(item),
        });
      });
    }
    return out;
  }, [scheduled, effectiveMode]);

  const isModeActive = (m: TripMapMode) =>
    m.kind === effectiveMode.kind &&
    (m.kind === "all" || (effectiveMode.kind === "day" && m.dayIndex === effectiveMode.dayIndex));

  const chipClass = (on: boolean) =>
    on
      ? "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background"
      : "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-foreground";

  return (
    <div className={paneLayout ? "flex flex-1 flex-col pb-3" : "pb-8"}>
      <div
        role="group"
        aria-label={copy.mapModeListLabel}
        className="flex gap-2 overflow-x-auto px-5 py-3 no-scrollbar"
      >
        <button
          type="button"
          aria-pressed={isModeActive(ALL_MODE)}
          onClick={() => changeMode(ALL_MODE)}
          className={chipClass(isModeActive(ALL_MODE))}
        >
          {copy.mapModeAll}
        </button>
        {scheduled.map((g) => {
          const dayIndex = g.dayNumber - 1;
          const on = isModeActive({ kind: "day", dayIndex });
          return (
            <button
              key={`${g.dateKey}-${g.dayNumber}`}
              type="button"
              aria-pressed={on}
              onClick={() => changeMode({ kind: "day", dayIndex })}
              className={chipClass(on)}
            >
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: dayColor(dayIndex) }}
              />
              {formatTripWorkspaceTemplate(copy.mapDayChip, { n: g.dayNumber })}
            </button>
          );
        })}
      </div>

      {initialCenter ? (
        <div
          data-no-page-swipe
          className={
            paneLayout
              ? "relative mx-3 min-h-[320px] flex-1 overflow-hidden rounded-2xl border border-border"
              : "relative mx-5 h-[58vh] min-h-[320px] overflow-hidden rounded-2xl border border-border"
          }
        >
          <GoogleMap
            center={initialCenter.center}
            zoom={initialCenter.zoom}
            placeMarkers={placeMarkers}
            polylines={polylines}
            fitToMarkers={fitRequest}
            visible={active}
            gestureHandling="greedy"
            onPlaceMarkerClick={handleMarkerClick}
            onMapClick={handleMapClick}
            onMapReady={handleMapReady}
          />

          {!hasAnyLocated || result.markers.length === 0 ? (
            <div className="pointer-events-none absolute inset-x-3 top-3 rounded-xl bg-background/90 px-4 py-3 text-center shadow-sm backdrop-blur">
              <p className="text-sm font-medium text-foreground">
                {hasAnyLocated ? copy.mapDayEmpty : copy.mapEmptyTitle}
              </p>
              {hasAnyLocated ? null : (
                <p className="mt-1 text-xs text-muted-foreground">{copy.mapEmptyBody}</p>
              )}
            </div>
          ) : null}

          {/* 卡片底部留 36px，讓 Google 標誌與條款（地圖底緣一列，約 26px 高）保持可見 */}
          {selected && selectedItem ? (
            <div className="absolute inset-x-3 bottom-9 rounded-2xl border border-border bg-card p-4 shadow-lg">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span
                      aria-hidden
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: selected.color }}
                    />
                    {formatTripWorkspaceTemplate(copy.mapStopLabel, {
                      n: selected.dayNumber,
                      m: selected.itemIndexInDay + 1,
                    })}
                  </p>
                  <p className="mt-1 truncate text-base font-medium text-foreground">
                    {tripMapItemTitle(selectedItem)}
                  </p>
                  {selectedItem.time?.trim() ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {selectedItem.time.trim()}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  aria-label={copy.mapCloseCard}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {selectedItem.description?.trim() ? (
                <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                  {selectedItem.description.trim()}
                </p>
              ) : null}
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  disabled={selectedIndex <= 0}
                  onClick={() => selectMarker(result.markers[selectedIndex - 1] ?? null, true)}
                  className="flex items-center gap-1 rounded-full bg-secondary px-3 py-2 text-xs font-medium text-foreground disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  {copy.mapPrevStop}
                </button>
                <button
                  type="button"
                  disabled={selectedIndex < 0 || selectedIndex >= result.markers.length - 1}
                  onClick={() => selectMarker(result.markers[selectedIndex + 1] ?? null, true)}
                  className="flex items-center gap-1 rounded-full bg-secondary px-3 py-2 text-xs font-medium text-foreground disabled:opacity-40"
                >
                  {copy.mapNextStop}
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onOpenDetail(
                      selectedItem,
                      { mode: effectiveMode, selectedId: selected.id },
                      selected.dayNumber - 1,
                    )
                  }
                  className="ml-auto rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background"
                >
                  {copy.mapViewDetails}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col items-center px-8 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
            <MapPin className="h-5 w-5" />
          </div>
          <p className="mt-4 text-sm font-medium text-foreground">{copy.mapEmptyTitle}</p>
          <p className="mt-1 text-sm text-muted-foreground">{copy.mapEmptyBody}</p>
        </div>
      )}

      {unlocated.length > 0 ? (
        <div className="mx-5 mt-3 rounded-2xl border border-border bg-card">
          <button
            type="button"
            aria-expanded={unlocatedOpen}
            onClick={() => setUnlocatedOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm text-foreground"
          >
            <span>
              {formatTripWorkspaceCount(copy.mapUnlocated, unlocated.length, copy.mapUnlocatedOne)}
            </span>
            <ChevronDown
              className={
                unlocatedOpen
                  ? "h-4 w-4 rotate-180 text-muted-foreground transition-transform"
                  : "h-4 w-4 text-muted-foreground transition-transform"
              }
            />
          </button>
          {unlocatedOpen ? (
            <div className="border-t border-border px-2 pb-2 pt-1">
              <p className="px-2 py-2 text-xs text-muted-foreground">{copy.mapUnlocatedHint}</p>
              <ul>
                {unlocated.map((entry) => (
                  <li key={entry.key}>
                    <button
                      type="button"
                      onClick={() => onGoToDay(entry.dayIndex)}
                      className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left active:bg-secondary"
                    >
                      <span
                        aria-hidden
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: dayColor(entry.dayIndex) }}
                      />
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatTripWorkspaceTemplate(copy.mapStopLabel, {
                          n: entry.dayNumber,
                          m: entry.stopNumber,
                        })}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {entry.title}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
