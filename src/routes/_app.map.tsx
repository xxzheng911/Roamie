import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Search, Navigation, Heart, Loader2, Star, MessageCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { GoogleMap } from "@/components/GoogleMap";
import { MapExploreSheet } from "@/components/MapExploreSheet";
import { MapPlacePreview } from "@/components/MapPlacePreview";
import { PlaceHoursBadge } from "@/components/PlaceHoursBadge";
import { PlaceNavButtons } from "@/components/PlaceNavButtons";
import { listPlaces, toggleSavePlace, type SavedPlace } from "@/lib/places-storage";
import { searchPlaces, type PlaceResult } from "@/lib/places.functions";
import { buildPlacePhotoUrl } from "@/lib/google-maps-client";
import { getWeather, type WeatherSummary } from "@/lib/weather.functions";
import { mapPlaceResultToChatItem, addSelectedPlace, saveChatSession, loadChatSession } from "@/lib/chat-session";
import { buildExploreQuery, savedPlacesNear } from "@/lib/map-explore";
import {
  DEFAULT_SEARCH_RADIUS_M,
  EXPLORE_CATEGORIES,
  type ExploreCategory,
} from "@/lib/places-search-config";
import { TAIPEI_CENTER, normalizeDeviceLocation } from "@/lib/geo";

export const Route = createFileRoute("/_app/map")({
  component: MapView,
});

const MAP_ZOOM = 15;

type MapPlaceCard = PlaceResult & { reason: string; googleMapsUrl?: string; isSavedFavorite?: boolean };

function savedToPlaceResult(s: SavedPlace): PlaceResult {
  return {
    id: `saved-${s.id}`,
    name: s.name,
    address: s.address,
    lat: s.lat,
    lng: s.lng,
    rating: null,
    userRatingCount: null,
    photoName: null,
    primaryType: s.category,
    businessStatus: null,
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "營業時間待確認",
    closingSoonNote: "",
    nextOpenHint: "",
  };
}

function resolveDeviceLocation(
  onSuccess: (loc: { lat: number; lng: number }, label: string) => void,
  onFallback: () => void,
) {
  if (!navigator.geolocation) {
    onFallback();
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const normalized = normalizeDeviceLocation(pos.coords.latitude, pos.coords.longitude);
      if (normalized) {
        onSuccess(normalized, "附近");
      } else {
        onFallback();
      }
    },
    () => onFallback(),
    { timeout: 15000, maximumAge: 0, enableHighAccuracy: true },
  );
}

function MapView() {
  const navigate = useNavigate();
  const mapPageRef = useRef<HTMLDivElement>(null);
  const searchPlacesFn = useServerFn(searchPlaces);
  const fetchWeather = useServerFn(getWeather);
  const [weather, setWeather] = useState<WeatherSummary | null>(null);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<ExploreCategory>(EXPLORE_CATEGORIES[0]);
  const [locationLabel, setLocationLabel] = useState("附近");
  const [results, setResults] = useState<MapPlaceCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [saved, setSaved] = useState<SavedPlace[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState(TAIPEI_CENTER);
  const [mapCenter, setMapCenter] = useState(TAIPEI_CENTER);
  const [geoReady, setGeoReady] = useState(false);
  const mapErrorToastedRef = useRef(false);

  const applyFallbackLocation = useCallback(() => {
    setUserLocation(TAIPEI_CENTER);
    setMapCenter(TAIPEI_CENTER);
    setLocationLabel("台北");
    setGeoReady(true);
  }, []);

  useEffect(() => {
    resolveDeviceLocation(
      (loc, label) => {
        setUserLocation(loc);
        setMapCenter(loc);
        setLocationLabel(label);
        setGeoReady(true);
      },
      applyFallbackLocation,
    );
  }, [applyFallbackLocation]);

  const handleMapLoadError = useCallback((message: string) => {
    if (!mapErrorToastedRef.current) {
      mapErrorToastedRef.current = true;
      toast.error(message, { duration: 6000 });
    }
  }, []);

  const refreshSaved = () => {
    listPlaces().then(setSaved).catch(() => {});
  };

  useEffect(() => {
    refreshSaved();
  }, []);

  useEffect(() => {
    if (!geoReady) return;
    fetchWeather({ data: { lat: userLocation.lat, lng: userLocation.lng } })
      .then((r) => setWeather(r.weather))
      .catch(() => {});
  }, [geoReady, userLocation.lat, userLocation.lng, fetchWeather]);

  useEffect(() => {
    if (!geoReady) return;
    const text = query.trim() || cat.query;
    const handle = setTimeout(() => {
      setLoading(true);
      setError(null);
      const exploreQuery = buildExploreQuery(text, { weather, timeIso: new Date().toISOString() });
      const isFreeText = !!query.trim();
      searchPlacesFn({
        data: {
          query: isFreeText ? exploreQuery : cat.query,
          lat: userLocation.lat,
          lng: userLocation.lng,
          radius: DEFAULT_SEARCH_RADIUS_M,
          mode: (isFreeText ? "text" : cat.mode) as "text" | "nearby" | "multi",
          includedTypes: isFreeText ? undefined : cat.includedTypes,
          nearbyGroups: isFreeText ? undefined : cat.nearbyGroups,
        },
      })
        .then((r) => {
          if (r.error) setError(r.error);
          const nearbySaved = savedPlacesNear(userLocation, saved, 5000);
          const apiNames = new Set(r.places.map((p) => p.name));
          const savedCards: MapPlaceCard[] = nearbySaved
            .filter((s) => !apiNames.has(s.name))
            .map((s) => {
              const base = savedToPlaceResult(s);
              return {
                ...base,
                reason: "你收藏的角落，就在附近，適合順路過去看看",
                isSavedFavorite: true,
              };
            });
          const enriched: MapPlaceCard[] = [
            ...savedCards,
            ...r.places.map((p) => {
              const item = mapPlaceResultToChatItem(p, { weather });
              return { ...p, reason: item.reason, googleMapsUrl: item.googleMapsUrl };
            }),
          ];
          setResults(enriched);
          setSelectedIdx(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : "搜尋失敗"))
        .finally(() => setLoading(false));
    }, query.trim() ? 400 : 0);
    return () => clearTimeout(handle);
  }, [query, cat, searchPlacesFn, geoReady, userLocation.lat, userLocation.lng, weather, saved]);

  const selectedPlace = selectedIdx != null ? results[selectedIdx] ?? null : null;

  const markers = useMemo(
    () =>
      results
        .filter((p) => p.lat != null && p.lng != null)
        .map((p) => ({
          lat: p.lat!,
          lng: p.lng!,
          title: p.name,
          selected: selectedIdx !== null && results[selectedIdx]?.id === p.id,
        })),
    [results, selectedIdx],
  );

  const savedByName = useMemo(() => new Map(saved.map((s) => [s.name, s])), [saved]);

  const selectPlace = (index: number) => {
    setSelectedIdx(index);
    const p = results[index];
    if (p?.lat != null && p?.lng != null) {
      setMapCenter({ lat: p.lat, lng: p.lng });
    }
  };

  const openInChat = (p: MapPlaceCard) => {
    const item = mapPlaceResultToChatItem(p, { weather });
    const base = loadChatSession();
    saveChatSession(addSelectedPlace({ ...base, phase: "followup" }, item));
    navigate({ to: "/chat", search: { from: "map" } });
    toast.message(`和 Roamie 聊聊「${p.name}」`);
  };

  const handleToggleSave = async (p: MapPlaceCard) => {
    setBusy(p.id);
    try {
      const { saved: didSave } = await toggleSavePlace({
        name: p.name,
        category: p.primaryType,
        address: p.address,
        city: locationLabel,
        lat: p.lat,
        lng: p.lng,
        notes: p.reason,
        mood_tag: null,
        cover_image: p.photoName ? (buildPlacePhotoUrl(p.photoName, 600) ?? null) : null,
      });
      toast.success(didSave ? "已收藏" : "已取消收藏");
      refreshSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失敗");
    } finally {
      setBusy(null);
    }
  };

  const locateMe = () => {
    resolveDeviceLocation(
      (loc, label) => {
        setUserLocation(loc);
        setMapCenter(loc);
        setLocationLabel(label);
        setSelectedIdx(null);
        toast.success("已定位");
      },
      () => {
        applyFallbackLocation();
        toast.error("無法取得位置，已改為台北");
      },
    );
  };

  return (
    <div
      ref={mapPageRef}
      className="relative h-[calc(100dvh-4.25rem-env(safe-area-inset-bottom,0px))] min-h-[520px] w-full overflow-hidden"
    >
      {/* 地圖背景 */}
      {geoReady ? (
        <GoogleMap
          center={mapCenter}
          zoom={MAP_ZOOM}
          markers={markers}
          onMarkerClick={(markerIdx) => {
            const withCoords = results.filter((p) => p.lat != null && p.lng != null);
            const p = withCoords[markerIdx];
            if (!p) return;
            selectPlace(results.indexOf(p));
          }}
          className="absolute inset-0 z-0 h-full w-full"
          onLoadError={handleMapLoadError}
        />
      ) : (
        <div className="absolute inset-0 z-0 flex items-center justify-center bg-secondary">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* 搜尋欄：高 z-index，不受 sheet 拖曳影響 */}
      <div className="absolute inset-x-0 top-0 z-[50] px-5 pt-3">
        <div className="flex items-center gap-2 rounded-full border border-border bg-card/95 px-4 py-3 shadow-soft backdrop-blur">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋 Google 地圖上的任何地點"
            className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={locateMe}
            className="shrink-0 rounded-full bg-secondary p-1.5"
            aria-label="重新定位"
          >
            <Navigation className="h-4 w-4" />
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={locateMe}
        className="absolute right-5 top-[4.75rem] z-[50] flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-soft"
        aria-label="我的位置"
      >
        <Navigation className="h-4 w-4" />
      </button>

      {/* 地點預覽卡 */}
      {selectedPlace && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[30%] z-[45] px-4">
          <MapPlacePreview
            place={selectedPlace}
            imageUrl={
              selectedPlace.photoName ? buildPlacePhotoUrl(selectedPlace.photoName, 800) : null
            }
            isSaved={savedByName.has(selectedPlace.name)}
            isBusy={busy === selectedPlace.id}
            onClose={() => setSelectedIdx(null)}
            onToggleSave={() => void handleToggleSave(selectedPlace)}
            onOpenChat={() => openInChat(selectedPlace)}
          />
        </div>
      )}

      {/* Draggable bottom sheet */}
      <MapExploreSheet containerRef={mapPageRef}>
        <div className="flex min-h-0 flex-1 flex-col px-5">
          <div className="shrink-0 pb-2">
            <p className="font-display text-lg leading-tight">推薦地點</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {locationLabel} · {loading ? "搜尋中…" : `${results.length} 個地方`}
              {cat.label ? ` · ${cat.label}` : ""}
              {saved.length > 0 ? ` · 已收藏 ${saved.length}` : ""}
            </p>
          </div>

          {/* 分類 chips */}
          <div className="shrink-0 overflow-x-auto pb-3 no-scrollbar">
            <div className="flex gap-2">
              {EXPLORE_CATEGORIES.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => {
                    setCat(c);
                    setMapCenter(userLocation);
                    setSelectedIdx(null);
                  }}
                  className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs ${
                    cat.label === c.label
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-card"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="shrink-0 mb-2 rounded-2xl bg-clay/15 px-3 py-2 text-xs text-clay">{error}</p>
          )}

          {/* 推薦卡片：收起時橫向預覽，展開後可上下滑動完整列表 */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4 no-scrollbar">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : results.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">附近沒有找到地點，換個分類或關鍵字試試</p>
            ) : (
              <>
                {/* 收起時可見的橫向卡片列 */}
                <div className="-mx-5 overflow-x-auto pb-3 no-scrollbar">
                  <div className="flex gap-3 px-5">
                    {results.map((p, i) => {
                      const isSaved = savedByName.has(p.name);
                      const isBusy = busy === p.id;
                      const img = p.photoName ? buildPlacePhotoUrl(p.photoName, 600) : null;
                      return (
                        <article
                          key={`peek-${p.id}`}
                          onClick={() => selectPlace(i)}
                          className={`w-[64%] shrink-0 cursor-pointer overflow-hidden rounded-3xl border bg-card shadow-soft transition ${
                            selectedIdx === i ? "border-foreground" : "border-border"
                          }`}
                        >
                          <div className="relative aspect-[4/3] overflow-hidden bg-secondary">
                            {img ? (
                              <img
                                src={img}
                                alt={p.name}
                                loading="lazy"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                                無圖
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleToggleSave(p);
                              }}
                              disabled={isBusy}
                              className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-card/95 shadow-soft backdrop-blur disabled:opacity-60"
                              aria-label={isSaved ? "移除收藏" : "收藏"}
                            >
                              {isBusy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Heart
                                  className={`h-4 w-4 ${isSaved ? "fill-clay text-clay" : "text-muted-foreground"}`}
                                />
                              )}
                            </button>
                            <span className="absolute bottom-2 left-2 rounded-full bg-card/90 px-2 py-0.5 text-[10px] text-muted-foreground backdrop-blur">
                              {cat.label}
                            </span>
                          </div>
                          <div className="p-3">
                            <div className="flex items-center justify-between gap-2">
                              <h3 className="truncate text-sm font-medium">{p.name}</h3>
                              {p.rating !== null && (
                                <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
                                  <Star className="h-3 w-3 fill-clay text-clay" />
                                  {p.rating.toFixed(1)}
                                </span>
                              )}
                            </div>
                            {p.address && (
                              <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
                                {p.address}
                              </p>
                            )}
                            <p className="mt-1.5 line-clamp-2 text-[11px] text-foreground/75">
                              {p.reason}
                            </p>
                            <PlaceHoursBadge
                              className="mt-1"
                              statusLabel={p.openStatusLabel}
                              todayHoursLabel={p.todayHoursLabel}
                              closingSoonNote={p.closingSoonNote}
                              nextOpenHint={p.nextOpenHint}
                            />
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </MapExploreSheet>
    </div>
  );
}
