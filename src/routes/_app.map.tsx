import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Search, SlidersHorizontal, Navigation, Heart, Loader2, Star, MessageCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { GoogleMap } from "@/components/GoogleMap";
import { PlaceNavButtons } from "@/components/PlaceNavButtons";
import { listPlaces, type SavedPlace } from "@/lib/places-storage";
import { searchPlaces, type PlaceResult } from "@/lib/places.functions";
import { buildPlacePhotoUrl } from "@/lib/google-maps-client";
import { getWeather, type WeatherSummary } from "@/lib/weather.functions";
import { mapPlaceResultToChatItem, addSelectedPlace, saveChatSession, loadChatSession } from "@/lib/chat-session";
import { buildExploreQuery, savedPlacesNear } from "@/lib/map-explore";
import { toggleSavePlace } from "@/lib/places-storage";

export const Route = createFileRoute("/_app/map")({
  component: MapView,
});

const categories = [
  { label: "全部", query: "popular spots cafe park" },
  { label: "咖啡", query: "quiet cafe" },
  { label: "書店", query: "bookstore" },
  { label: "公園", query: "park" },
  { label: "在地小吃", query: "local food" },
  { label: "夜晚", query: "night spot bar" },
];

const TAIPEI = { lat: 25.0478, lng: 121.5319 };

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
    openStatus: "unknown",
    openStatusLabel: "",
  };
}

function MapView() {
  const navigate = useNavigate();
  const search = useServerFn(searchPlaces);
  const fetchWeather = useServerFn(getWeather);
  const [weather, setWeather] = useState<WeatherSummary | null>(null);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState(categories[0]);
  const [city, setCity] = useState("台北");
  const [results, setResults] = useState<MapPlaceCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [saved, setSaved] = useState<SavedPlace[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [center, setCenter] = useState(TAIPEI);
  const [geoReady, setGeoReady] = useState(false);

  const refreshSaved = () => {
    listPlaces().then(setSaved).catch(() => {});
  };

  useEffect(() => {
    refreshSaved();
  }, []);

  // Prefer device location; only keep Taipei default when geolocation fails
  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoReady(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setCity("");
        setGeoReady(true);
      },
      () => {
        console.warn("[Roamie Map] geolocation failed, using Taipei fallback");
        setGeoReady(true);
      },
      { timeout: 12000, maximumAge: 5 * 60 * 1000, enableHighAccuracy: true },
    );
  }, []);

  useEffect(() => {
    if (!geoReady) return;
    fetchWeather({ data: { lat: center.lat, lng: center.lng } })
      .then((r) => setWeather(r.weather))
      .catch(() => {});
  }, [geoReady, center.lat, center.lng, fetchWeather]);

  // Fetch places when query/category/city/location changes (debounced)
  useEffect(() => {
    if (!geoReady) return;
    const text = query.trim() || cat.query;
    const handle = setTimeout(() => {
      setLoading(true);
      setError(null);
      const exploreQuery = buildExploreQuery(text, { weather, timeIso: new Date().toISOString() });
      const payload = query.trim()
        ? { query: exploreQuery, city: "", lat: center.lat, lng: center.lng, radius: 20000 }
        : {
            query: exploreQuery,
            city: city || (geoReady ? "" : "台北"),
            lat: center.lat,
            lng: center.lng,
            radius: 15000,
          };
      search({ data: payload })
        .then((r) => {
          if (r.error) setError(r.error);
          const nearbySaved = savedPlacesNear(center, saved, 5000);
          const apiNames = new Set(r.places.map((p) => p.name));
          const savedCards: MapPlaceCard[] = nearbySaved
            .filter((s) => !apiNames.has(s.name))
            .map((s) => {
              const base = savedToPlaceResult(s);
              return {
                ...base,
                reason: "你收藏的角落，就在附近，適合順路過去看看",
                googleMapsUrl:
                  base.lat != null && base.lng != null
                    ? `https://www.google.com/maps/search/?api=1&query=${base.lat},${base.lng}`
                    : undefined,
                isSavedFavorite: true,
              };
            });
          const enriched: MapPlaceCard[] = [
            ...savedCards,
            ...r.places.map((p) => {
              const item = mapPlaceResultToChatItem(p, { weather });
              let reason = item.reason;
              if (p.openStatusLabel === "即將打烊") reason += "（即將打烊，建議提早前往）";
              if (p.openStatusLabel === "今日休息") reason = "今日休息，可先改去其他選項";
              return {
                ...p,
                reason,
                googleMapsUrl: item.googleMapsUrl,
              };
            }),
          ];
          setResults(enriched);
          const first = enriched.find((p) => p.lat !== null && p.lng !== null);
          if (first?.lat && first?.lng) setCenter({ lat: first.lat, lng: first.lng });
        })
        .catch((e) => setError(e instanceof Error ? e.message : "搜尋失敗"))
        .finally(() => setLoading(false));
    }, query.trim() ? 400 : 0);
    return () => clearTimeout(handle);
  }, [query, cat, city, search, geoReady, center.lat, center.lng, weather, saved]);

  const markers = useMemo(
    () =>
      results
        .filter((p) => p.lat !== null && p.lng !== null)
        .map((p, i) => ({ lat: p.lat!, lng: p.lng!, title: p.name, selected: selectedIdx === i })),
    [results, selectedIdx]
  );

  const savedByName = useMemo(() => new Map(saved.map((s) => [s.name, s])), [saved]);

  const openInChat = (p: MapPlaceCard) => {
    const item = mapPlaceResultToChatItem(p, { weather });
    const base = loadChatSession();
    saveChatSession(addSelectedPlace({ ...base, phase: "followup" }, item));
    navigate({ to: "/chat", search: { from: "map" } });
    toast.message(`和 Roamie 聊聊「${p.name}」`);
  };

  const toggleSave = async (p: MapPlaceCard) => {
    setBusy(p.id);
    try {
      const { saved } = await toggleSavePlace({
        name: p.name,
        category: p.primaryType,
        address: p.address,
        city,
        lat: p.lat,
        lng: p.lng,
        notes: p.reason,
        mood_tag: null,
        cover_image: p.photoName ? buildPlacePhotoUrl(p.photoName, 600) : null,
      });
      toast.success(saved ? "已收藏" : "已取消收藏");
      refreshSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失敗");
    } finally {
      setBusy(null);
    }
  };

  const locateMe = () => {
    if (!navigator.geolocation) {
      setCenter(TAIPEI);
      toast.error("瀏覽器不支援定位，已改為台北");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setCity("");
        toast.success("已定位");
      },
      () => {
        setCenter(TAIPEI);
        toast.error("無法取得位置，已改為台北");
      },
      { timeout: 12000, maximumAge: 0, enableHighAccuracy: true },
    );
  };

  return (
    <div className="relative h-full min-h-[760px]">
      {/* Real Google Map */}
      <GoogleMap center={center} markers={markers} onMarkerClick={setSelectedIdx} className="absolute inset-0" />

      {/* Top search */}
      <div className="absolute left-5 right-5 top-4 z-10">
        <div className="flex items-center gap-2 rounded-full border border-border bg-card/95 px-4 py-3 shadow-soft backdrop-blur">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋 Google 地圖上的任何地點"
            className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            onClick={() => {
              const next = prompt("換城市", city);
              if (next) setCity(next);
            }}
            className="rounded-full bg-secondary p-1.5"
            aria-label="換城市"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-2.5 flex gap-2 overflow-x-auto no-scrollbar">
          {categories.map((c) => (
            <button
              key={c.label}
              onClick={() => setCat(c)}
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

      {/* Right side controls */}
      <div className="absolute right-5 top-44 z-10 flex flex-col gap-2">
        <button
          onClick={locateMe}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-soft"
          aria-label="我的位置"
        >
          <Navigation className="h-4 w-4" />
        </button>
      </div>

      {/* Bottom sheet */}
      <div className="absolute bottom-0 left-0 right-0 max-h-[55%] overflow-hidden rounded-t-[2rem] border-t border-border bg-background/95 p-5 shadow-lift backdrop-blur">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
        <div className="flex items-center justify-between">
          <div>
            <p className="font-display text-lg leading-tight">
              {city} · {loading ? "搜尋中…" : `${results.length} 個地方`}
            </p>
            <p className="text-xs text-muted-foreground">{cat.label} · 已收藏 {saved.length}</p>
          </div>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {error && (
          <p className="mt-3 rounded-2xl bg-clay/15 px-3 py-2 text-xs text-clay">{error}</p>
        )}

        <div className="mt-4 -mx-5 overflow-x-auto no-scrollbar">
          <div className="flex gap-3 px-5 pb-4">
            {!loading && results.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">沒有找到地點，換個關鍵字試試</p>
            ) : (
              results.map((p, i) => {
                const isSaved = savedByName.has(p.name);
                const isBusy = busy === p.id;
                const img = p.photoName ? buildPlacePhotoUrl(p.photoName, 600) : null;
                return (
                  <article
                    key={p.id}
                    onClick={() => {
                      setSelectedIdx(i);
                      if (p.lat && p.lng) setCenter({ lat: p.lat, lng: p.lng });
                    }}
                    className={`w-[64%] shrink-0 cursor-pointer overflow-hidden rounded-3xl border bg-card shadow-soft transition ${
                      selectedIdx === i ? "border-foreground" : "border-border"
                    }`}
                  >
                    <div className="relative aspect-[4/3] overflow-hidden bg-secondary">
                      {img ? (
                        <img src={img} alt={p.name} loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                          無圖
                        </div>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSave(p);
                        }}
                        disabled={isBusy}
                        className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-card/95 shadow-soft backdrop-blur disabled:opacity-60"
                        aria-label={isSaved ? "移除收藏" : "收藏"}
                      >
                        {isBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Heart className={`h-4 w-4 ${isSaved ? "fill-clay text-clay" : "text-muted-foreground"}`} />
                        )}
                      </button>
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
                        <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">{p.address}</p>
                      )}
                      <p className="mt-1.5 line-clamp-2 text-[11px] text-foreground/75">{p.reason}</p>
                      {p.openStatusLabel ? (
                        <p className="mt-1 text-[10px] text-muted-foreground">{p.openStatusLabel}</p>
                      ) : null}
                      <PlaceNavButtons
                        lat={p.lat}
                        lng={p.lng}
                        address={p.address}
                        placeName={p.name}
                        compact
                        className="mt-2"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openInChat(p);
                        }}
                        className="mt-2 flex w-full items-center justify-center gap-1 rounded-full border border-border py-1.5 text-[10px]"
                      >
                        <MessageCircle className="h-3 w-3" />
                        和 Roamie 聊這裡
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
