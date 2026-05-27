import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MapPin } from "lucide-react";
import {
  searchTripLocations,
  resolveTripLocation,
} from "@/lib/location.functions";
import { searchTripStops, resolveTripStop } from "@/lib/trip-stop-search.functions";
import { unifiedSearchTripLocations, unifiedResolveTripLocation } from "@/lib/location-search-unified";
import {
  unifiedResolveTripStop,
  unifiedSearchTripStops,
} from "@/lib/trip-stop-search-unified";
import { formatTripLocationLabel } from "@/lib/location/format";
import type { LocationSuggestion, TripLocation } from "@/lib/location/types";
import { useI18n } from "@/hooks/use-i18n";
import type { PlaceSearchResultItem } from "@/components/PlaceSearchPanel";
import { PlaceSearchResultsList } from "@/components/PlaceSearchResultsList";
import {
  logTripPlace,
  tripLocationToPlaceRef,
  tripPlaceInputToTripLocation,
  type TripPlaceFieldRole,
} from "@/lib/trip/trip-place-ref";

export type LocationSearchMode = "geographic" | "place";

type Props = {
  label: string;
  value: TripLocation | null;
  onChange: (loc: TripLocation | null) => void;
  placeholder: string;
  disabled?: boolean;
  required?: boolean;
  /** 獨立欄位識別（日誌與除錯） */
  fieldRole: TripPlaceFieldRole;
  /** geographic：國家/城市；place：車站/地址/POI（出發地） */
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

  const searchGeoFn = useServerFn(searchTripLocations);
  const resolveGeoFn = useServerFn(resolveTripLocation);
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
        let list: LocationSuggestion[] = [];
        let error: string | null = null;

        if (searchMode === "place") {
          const stopResult = await unifiedSearchTripStops(searchStopFn, trimmed, locale);
          list = stopResult.suggestions.map((s) => ({
            placeId: s.placeId,
            label: s.label,
            secondary: s.secondary,
          }));
          error = stopResult.error;
        } else {
          const geoResult = await unifiedSearchTripLocations(searchGeoFn, trimmed, locale);
          list = geoResult.suggestions;
          error = geoResult.error;
        }

        if (gen !== searchGenRef.current) return;

        logTripPlace(fieldRole, "autocomplete", {
          count: list.length,
          error: error ?? undefined,
          first: list[0]?.label,
        });

        if (list.length === 0 && error) {
          setSearchError(error);
        } else if (list.length === 0) {
          setSearchError(t("location.notFound"));
        } else {
          setSearchError(null);
        }
        setSuggestions(list);
      } catch (e) {
        if (gen !== searchGenRef.current) return;
        console.error("[LocationSearch] failed", fieldRole, e);
        setSuggestions([]);
        setSearchError(t("location.searchFailed"));
      } finally {
        if (gen === searchGenRef.current) {
          setSearching(false);
        }
      }
    },
    [fieldRole, locale, searchGeoFn, searchMode, searchStopFn, t],
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
      onChange(location);
      logTripPlace(fieldRole, "saved", tripLocationToPlaceRef(location));
    },
    [fieldRole, onChange],
  );

  const handleSelect = async (item: PlaceSearchResultItem) => {
    logTripPlace(fieldRole, "selected", {
      placeId: item.placeId,
      label: item.label,
    });
    setResolvingId(item.placeId);
    try {
      if (searchMode === "place") {
        const { place, error } = await unifiedResolveTripStop(resolveStopFn, item.placeId, locale, {
          placeId: item.placeId,
          label: item.label,
          secondary: item.secondary,
        });
        if (error && !place) {
          setSearchError(error);
          return;
        }
        if (!place) {
          setSearchError(t("location.resolveFailed"));
          return;
        }
        const location = tripPlaceInputToTripLocation(place, item.placeId);
        if (!location) {
          setSearchError(t("location.resolveFailed"));
          return;
        }
        logTripPlace(fieldRole, "details", tripLocationToPlaceRef(location));
        commitLocation(location);
        return;
      }

      const { location, error } = await unifiedResolveTripLocation(resolveGeoFn, item.placeId, locale, {
        name: item.label,
        address: item.secondary,
      });
      if (error && !location) {
        setSearchError(error);
        return;
      }
      if (!location) {
        setSearchError(t("location.resolveFailed"));
        return;
      }
      logTripPlace(fieldRole, "details", tripLocationToPlaceRef(location));
      commitLocation(location);
    } catch (e) {
      console.error("[LocationSearch] resolve failed", fieldRole, e);
      setSearchError(t("location.resolveFailed"));
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

  const showResults = focused && (searching || query.trim().length > 0);
  const showPickHint = Boolean(query.trim()) && !value && !searching && !searchError;

  return (
    <section className="relative">
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
          emptyMessage={t("location.notFound")}
        />
      ) : null}
    </section>
  );
}
