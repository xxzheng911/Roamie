import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Search } from "lucide-react";
import { searchTripStops, resolveTripStop } from "@/lib/trip-stop-search.functions";
import { PlaceSearchPanel, type PlaceSearchResultItem } from "@/components/PlaceSearchPanel";
import type { TripPlaceInput } from "@/lib/trip/trip-place-input";
import { useI18n } from "@/hooks/use-i18n";
import { useAddPlaceKeyboardLayout } from "@/hooks/use-add-place-keyboard-layout";
import { toast } from "sonner";
import { getPlaceDetails, searchPlaces as searchPlacesService } from "@/services/placesService";
import { PLACES_AUTOCOMPLETE_DEBOUNCE_MS } from "@/lib/places-cache-config";
import { TRIP_PLACE_USER_MESSAGE } from "@/lib/trip-place-search-log";
import { buildTripStopSearchQuery } from "@/lib/trip/build-trip-stop-search-query";
import { cn } from "@/lib/utils";

/** 固定輸入列高度估算（供結果列表 bottom 偏移） */
const ADD_PLACE_COMPOSER_ESTIMATE_PX = 56;
const ADD_PLACE_RESULTS_GAP_PX = 8;

type Props = {
  label?: string;
  onPick: (place: TripPlaceInput) => void;
  disabled?: boolean;
  /** button：先顯示「新增地點」按鈕；inline：直接顯示搜尋框（行程頁自行輸入） */
  variant?: "button" | "inline";
  /** 行程目的地（城市／國家），用於組合搜尋 query */
  destination?: string | null;
  /** 目的地座標，Autocomplete bias + Text Search */
  center?: { lat: number; lng: number } | null;
};

const ADD_PLACE_EMPTY_MESSAGE = TRIP_PLACE_USER_MESSAGE;

export function TripStopSearchField({
  label,
  onPick,
  disabled,
  variant = "button",
  destination,
  center,
}: Props) {
  const { t, locale } = useI18n();
  const inline = variant === "inline";
  const [open, setOpen] = useState(inline);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const searchFn = useServerFn(searchTripStops);
  const resolveFn = useServerFn(resolveTripStop);

  const { inputBottomPx, composerPaddingBottomPx, notifyInputFocused } =
    useAddPlaceKeyboardLayout(inline && open, composerRef);

  useEffect(() => {
    if (inline) {
      document.documentElement.classList.add("trip-add-place-keyboard-open");
      return () => {
        document.documentElement.classList.remove("trip-add-place-keyboard-open");
      };
    }
  }, [inline]);

  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) {
        setResults([]);
        setSearchError(null);
        return;
      }
      const scoped = buildTripStopSearchQuery(trimmed, destination);
      console.log("[TRIP_ADD_PLACE_SEARCH] query=", scoped, "destination=", destination ?? "");
      setSearching(true);
      setSearchError(null);
      try {
        const { suggestions, error } = await searchPlacesService(trimmed, {
          locale,
          destination,
          center: center ?? undefined,
          searchFn,
        });
        if (error && suggestions.length === 0) {
          setSearchError(error);
        }
        setResults(
          suggestions.map((s) => ({
            placeId: s.placeId,
            label: s.label,
            secondary: s.secondary,
            typeLabel: s.types?.[0],
            photoUrl: null,
          })),
        );
      } catch (e) {
        console.error("[TripStopSearch]", e);
        setSearchError(t("location.searchFailed"));
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [searchFn, locale, t, destination, center],
  );

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), PLACES_AUTOCOMPLETE_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, runSearch]);

  const handleSelect = async (item: PlaceSearchResultItem) => {
    setResolvingId(item.placeId);
    try {
      const { place, error } = await getPlaceDetails(item.placeId, {
        locale,
        resolveFn,
        fallback: { placeId: item.placeId, label: item.label, secondary: item.secondary },
      });
      if (
        !place ||
        !Number.isFinite(place.lat ?? NaN) ||
        !Number.isFinite(place.lng ?? NaN)
      ) {
        const msg = error ?? TRIP_PLACE_USER_MESSAGE;
        console.warn("[TRIP_ADD_PLACE_SELECTED] failed placeId=", item.placeId, msg);
        toast.message(msg);
        return;
      }
      const picked: TripPlaceInput = {
        name: place.name,
        placeName: place.name,
        title: place.name,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        googlePlaceId: place.placeId,
        placeType: place.placeType,
        types: place.types,
        googleMapsUrl: place.googleMapsUrl,
        googleMapsUri: place.googleMapsUri,
        photoName: place.photoName,
        rating: place.rating,
        userRatingCount: place.userRatingCount ?? null,
        businessStatus: place.businessStatus ?? null,
        openStatusLabel: place.openStatusLabel,
        todayHoursLabel: place.todayHoursLabel,
      };
      if (typeof onPick !== "function") {
        console.error("[TRIP_ADD_PLACE_SELECTED] onPick is not a function");
        toast.error("無法加入地點，請重試");
        return;
      }
      onPick(picked);
      if (!inline) {
        setOpen(false);
        setQuery("");
      } else {
        setQuery("");
        setResults([]);
        setSearchError(null);
      }
    } finally {
      setResolvingId(null);
    }
  };

  const resultsBottomPx =
    inputBottomPx + ADD_PLACE_COMPOSER_ESTIMATE_PX + ADD_PLACE_RESULTS_GAP_PX;

  const searchPanel = (
    <PlaceSearchPanel
      open={open}
      query={query}
      onQueryChange={setQuery}
      onClose={() => {
        if (inline) return;
        setOpen(false);
      }}
      onInputFocus={inline ? notifyInputFocused : undefined}
      results={results.map((r) => ({
        ...r,
        photoUrl: r.photoUrl ?? null,
      }))}
      searching={searching}
      resolvingId={resolvingId}
      onSelect={handleSelect}
      placeholder={t("trip.searchStopPlaceholder")}
      emptyMessage={searchError ?? ADD_PLACE_EMPTY_MESSAGE}
      hideResults={inline}
      hideCloseButton={inline}
      className={inline ? "mt-0 shadow-none border-0 rounded-none" : undefined}
    />
  );

  if (inline) {
    const showResultsPanel = open && query.trim() && (results.length > 0 || !searching);
    return (
      <>
        {showResultsPanel ? (
          <ul
            className="fixed inset-x-3 z-[170] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card shadow-soft"
            style={{
              bottom: `${resultsBottomPx}px`,
              maxHeight: `min(45vh, calc(100dvh - ${resultsBottomPx}px - 80px))`,
            }}
          >
            {results.length === 0 && !searching ? (
              <li className="px-3 py-8 text-center text-sm text-muted-foreground">
                {searchError ?? ADD_PLACE_EMPTY_MESSAGE}
              </li>
            ) : null}
            {results.map((s) => (
              <li key={s.placeId} className="border-b border-border/40 last:border-0">
                <button
                  type="button"
                  disabled={resolvingId === s.placeId}
                  onClick={() => handleSelect(s)}
                  className="flex w-full items-start gap-2 px-3 py-3 text-left transition hover:bg-secondary/80 active:bg-secondary disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium leading-snug">{s.label}</span>
                    {s.secondary ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {s.secondary}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div
          ref={composerRef}
          className={cn(
            "trip-add-place-composer pointer-events-auto fixed inset-x-0 z-[180]",
            "border-t border-border bg-background/95 backdrop-blur px-3 pt-2",
          )}
          style={{
            bottom: `${inputBottomPx}px`,
            marginBottom: 0,
            paddingBottom: composerPaddingBottomPx > 0 ? `${composerPaddingBottomPx}px` : 0,
            transform: "none",
          }}
        >
          {searchPanel}
        </div>
        <div
          className="pointer-events-none"
          style={{ height: ADD_PLACE_COMPOSER_ESTIMATE_PX + inputBottomPx }}
          aria-hidden
        />
      </>
    );
  }

  return (
    <section>
      {label ? <p className="mb-2 text-sm font-medium text-foreground/90">{label}</p> : null}
      {!inline ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card/80 py-3 text-sm text-muted-foreground transition hover:border-foreground/25 hover:bg-card disabled:opacity-50"
        >
          {open ? <Search className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {t("trip.addStop")}
        </button>
      ) : null}
      {searchPanel}
    </section>
  );
}
