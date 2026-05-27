import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MapPin } from "lucide-react";
import { searchTripStops, resolveTripStop } from "@/lib/trip-stop-search.functions";
import { formatTripLocationLabel } from "@/lib/location/format";
import type { LocationSuggestion, TripLocation } from "@/lib/location/types";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";
import type { PlaceSearchResultItem } from "@/components/PlaceSearchPanel";
import { PlaceSearchResultsList } from "@/components/PlaceSearchResultsList";
import {
  logTripPlace,
  tripLocationToPlaceRef,
  tripPlaceInputToTripLocation,
  type TripPlaceFieldRole,
} from "@/lib/trip/trip-place-ref";
import { getPlaceDetails, searchPlaces as searchPlacesService } from "@/services/placesService";

export type LocationSearchMode = "geographic" | "place";
const PLACE_NOT_FOUND_MESSAGE = "找不到相關地點";
const PLACE_API_ERROR_MESSAGE = "暫時無法搜尋地點";

function createPlacesSessionToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `places-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type Props = {
  label: string;
  value: TripLocation | null;
  onChange: (loc: TripLocation | null) => void;
  placeholder: string;
  disabled?: boolean;
  required?: boolean;
  fieldRole: TripPlaceFieldRole;
  searchMode?: LocationSearchMode;
};

export function LocationSearchField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  required,
  fieldRole,
  searchMode = "geographic",
}: Props) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchGenRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const committedLabelRef = useRef<string | null>(null);
  const sessionTokenRef = useRef(createPlacesSessionToken());

  const searchStopFn = useServerFn(searchTripStops);
  const resolveStopFn = useServerFn(resolveTripStop);

  useEffect(() => {
    if (value) {
      const labelText = formatTripLocationLabel(value);
      setQuery(labelText);
      committedLabelRef.current = labelText;
    } else if (!focused) {
      setQuery("");
      committedLabelRef.current = null;
    }
  }, [value, focused]);

  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      logTripPlace(fieldRole, "search", { query: trimmed, mode: searchMode });
      if (trimmed.length < 2) {
        setSuggestions([]);
        setSearchError(null);
        return;
      }
      const gen = ++searchGenRef.current;
      setSearching(true);
      setSearchError(null);
      try {
        const stopResult = await searchPlacesService(trimmed, {
          locale,
          sessionToken: sessionTokenRef.current,
          searchFn: searchStopFn,
        });
        const list: LocationSuggestion[] = stopResult.suggestions.map((s) => ({
          placeId: s.placeId,
          label: s.label,
          secondary: s.secondary,
        }));

        if (gen !== searchGenRef.current) return;

        logTripPlace(fieldRole, "autocomplete", {
          count: list.length,
          error: stopResult.error ?? undefined,
          first: list[0]?.label,
        });

        if (list.length === 0 && stopResult.error) {
          setSearchError(PLACE_API_ERROR_MESSAGE);
        } else if (list.length === 0) {
          setSearchError(PLACE_NOT_FOUND_MESSAGE);
        } else {
          setSearchError(null);
        }
        setSuggestions(list);
      } catch (e) {
        if (gen !== searchGenRef.current) return;
        console.error("[LocationSearch] failed", fieldRole, e);
        setSuggestions([]);
        setSearchError(PLACE_API_ERROR_MESSAGE);
      } finally {
        if (gen === searchGenRef.current) {
          setSearching(false);
        }
      }
    },
    [fieldRole, locale, searchMode, searchStopFn],
  );

  useEffect(() => {
    if (!focused) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void runSearch(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, focused, runSearch]);

  const commitLocation = useCallback(
    (location: TripLocation) => {
      const labelText = formatTripLocationLabel(location);
      committedLabelRef.current = labelText;
      setQuery(labelText);
      setFocused(false);
      setSuggestions([]);
      setSearchError(null);
      sessionTokenRef.current = createPlacesSessionToken();
      onChange(location);
      logTripPlace(fieldRole, "saved", tripLocationToPlaceRef(location));
    },
    [fieldRole, onChange],
  );

  const handleSelect = async (item: PlaceSearchResultItem) => {
    console.info("[PLACE_SELECT] rawPrediction=", JSON.stringify(item));
    console.info("[PLACE_SELECT] placeId=", item.placeId ?? "");
    console.info("[PLACE_SELECT] description=", [item.label, item.secondary].filter(Boolean).join(" · "));
    logTripPlace(fieldRole, "selected", {
      placeId: item.placeId,
      label: item.label,
    });
    setResolvingId(item.placeId);
    try {
      const { place, error } = await getPlaceDetails(item.placeId, {
        locale,
        resolveFn: resolveStopFn,
        fallback: {
          placeId: item.placeId,
          label: item.label,
          secondary: item.secondary,
        },
      });
      if (error && !place) {
        setSearchError(PLACE_API_ERROR_MESSAGE);
        return;
      }
      if (!place) {
        setSearchError(t("location.resolveFailed"));
        return;
      }
      const location = tripPlaceInputToTripLocation(
        {
          name: place.name,
          placeName: place.name,
          title: place.name,
          address: place.address || [item.label, item.secondary].filter(Boolean).join(" · "),
          lat: place.lat,
          lng: place.lng,
          googlePlaceId: place.placeId,
          placeType: place.placeType,
        },
        item.placeId,
      );
      logTripPlace(fieldRole, "details", tripLocationToPlaceRef(location));
      commitLocation(location);
    } catch (e) {
      console.error("[LocationSearch] resolve failed", fieldRole, e);
      setSearchError(PLACE_API_ERROR_MESSAGE);
    } finally {
      setResolvingId(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (suggestions[0]) {
        void handleSelect({
          placeId: suggestions[0].placeId,
          label: suggestions[0].label,
          secondary: suggestions[0].secondary,
        });
      }
    }
    if (e.key === "Escape") {
      setFocused(false);
      inputRef.current?.blur();
    }
  };

  const panelResults: PlaceSearchResultItem[] = suggestions.map((s) => ({
    placeId: s.placeId,
    label: s.label,
    secondary: s.secondary,
  }));

  const showResults = focused && (searching || (query.trim().length > 0 && !searchError));
  const showPickHint =
    Boolean(query.trim()) && !value && !searching && !searchError && suggestions.length > 0;

  return (
    <section className={cn("relative", focused && "z-30")}>
      <label className="text-sm font-medium">
        {label}
        {required ? " *" : ""}
      </label>
      <div className="relative mt-2">
        <MapPin
          className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          value={query}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            setSearchError(null);
            if (!next.trim()) {
              committedLabelRef.current = null;
              sessionTokenRef.current = createPlacesSessionToken();
              onChange(null);
              setSuggestions([]);
              return;
            }
            if (value && committedLabelRef.current && next !== committedLabelRef.current) {
              committedLabelRef.current = null;
              onChange(null);
            }
          }}
          onFocus={() => {
            if (blurCloseRef.current) clearTimeout(blurCloseRef.current);
            setFocused(true);
          }}
          onBlur={() => {
            blurCloseRef.current = setTimeout(() => setFocused(false), 200);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          enterKeyHint="search"
          className="w-full rounded-2xl border border-border bg-card py-3 pl-11 pr-10 text-[15px] focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
        />
        {searching ? (
          <Loader2 className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {value ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">{tripLocationToPlaceRef(value).name}</span>
          {value.address ? ` · ${value.address}` : null}
        </p>
      ) : null}

      {showPickHint ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{t("plan.pickPlaceFromResults")}</p>
      ) : null}

      {searchError ? (
        <p className="mt-1.5 text-xs text-destructive" role="alert">
          {searchError}
        </p>
      ) : null}

      {showResults ? (
        <PlaceSearchResultsList
          results={panelResults}
          searching={searching}
          resolvingId={resolvingId}
          onSelect={(item) => void handleSelect(item)}
          query={query}
          emptyMessage={PLACE_NOT_FOUND_MESSAGE}
        />
      ) : null}
    </section>
  );
}
