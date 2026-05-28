import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Search } from "lucide-react";
import { searchTripStops, resolveTripStop } from "@/lib/trip-stop-search.functions";
import { PlaceSearchPanel, type PlaceSearchResultItem } from "@/components/PlaceSearchPanel";
import type { TripPlaceInput } from "@/lib/trip/trip-place-input";
import { useI18n } from "@/hooks/use-i18n";
import { toast } from "sonner";
import { getPlaceDetails, searchPlaces as searchPlacesService } from "@/services/placesService";
import { PLACES_AUTOCOMPLETE_DEBOUNCE_MS } from "@/lib/places-cache-config";
import { TRIP_PLACE_USER_MESSAGE } from "@/lib/trip-place-search-log";

type Props = {
  label?: string;
  onPick: (place: TripPlaceInput) => void;
  disabled?: boolean;
  /** button：先顯示「新增地點」按鈕；inline：直接顯示搜尋框（行程頁自行輸入） */
  variant?: "button" | "inline";
};

export function TripStopSearchField({
  label,
  onPick,
  disabled,
  variant = "button",
}: Props) {
  const { t, locale } = useI18n();
  const inline = variant === "inline";
  const [open, setOpen] = useState(inline);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchFn = useServerFn(searchTripStops);
  const resolveFn = useServerFn(resolveTripStop);

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
        return;
      }
      console.log("[TRIP_ADD_PLACE_SEARCH] query=", trimmed);
      setSearching(true);
      try {
        const { suggestions, error } = await searchPlacesService(trimmed, {
          locale,
          searchFn,
        });
        if (error && suggestions.length === 0) {
          toast.message(error);
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
        toast.error(t("location.searchFailed"));
      } finally {
        setSearching(false);
      }
    },
    [searchFn, locale, t],
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
      if (!place) {
        const msg = error ?? TRIP_PLACE_USER_MESSAGE;
        console.warn("[TRIP_ADD_PLACE_SELECTED] failed placeId=", item.placeId, msg);
        toast.error(msg);
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
      };
      console.log(
        "[TRIP_ADD_PLACE_SELECTED] place=",
        JSON.stringify({
          name: picked.name,
          address: picked.address,
          lat: picked.lat,
          lng: picked.lng,
          placeId: picked.googlePlaceId,
        }),
      );
      onPick(picked);
      if (!inline) {
        setOpen(false);
        setQuery("");
      } else {
        setQuery("");
        setResults([]);
      }
    } finally {
      setResolvingId(null);
    }
  };

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
      <PlaceSearchPanel
        open={open}
        query={query}
        onQueryChange={setQuery}
        onClose={() => {
          if (inline) return;
          setOpen(false);
        }}
        results={results.map((r) => ({
          ...r,
          photoUrl: r.photoUrl ?? null,
        }))}
        searching={searching}
        resolvingId={resolvingId}
        onSelect={handleSelect}
        placeholder={t("trip.searchStopPlaceholder")}
      />
    </section>
  );
}
