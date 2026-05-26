import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MapPin } from "lucide-react";
import {
  geocodeTripLocationFromText,
  searchTripLocations,
  resolveTripLocation,
} from "@/lib/location.functions";
import { unifiedSearchTripLocations, unifiedResolveTripLocation } from "@/lib/location-search-unified";
import { formatTripLocationLabel } from "@/lib/location/format";
import type { LocationSuggestion, TripLocation } from "@/lib/location/types";
import { toast } from "sonner";
import { useI18n } from "@/hooks/use-i18n";
import type { PlaceSearchResultItem } from "@/components/PlaceSearchPanel";
import { PlaceSearchResultsList } from "@/components/PlaceSearchResultsList";

type Props = {
  label: string;
  value: TripLocation | null;
  onChange: (loc: TripLocation | null) => void;
  placeholder: string;
  disabled?: boolean;
  required?: boolean;
};

export function LocationSearchField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  required,
}: Props) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchGenRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchFn = useServerFn(searchTripLocations);
  const resolveFn = useServerFn(resolveTripLocation);
  const geocodeFn = useServerFn(geocodeTripLocationFromText);

  useEffect(() => {
    if (value) {
      setQuery(formatTripLocationLabel(value));
    } else if (!focused) {
      setQuery("");
    }
  }, [value, focused]);

  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (trimmed.length < 2) {
        setSuggestions([]);
        return;
      }
      const gen = ++searchGenRef.current;
      setSearching(true);
      try {
        const { suggestions: list, error } = await unifiedSearchTripLocations(
          searchFn,
          trimmed,
          locale,
        );
        if (gen !== searchGenRef.current) return;

        if (list.length === 0) {
          try {
            const geo = await geocodeFn({ data: { query: trimmed, locale } });
            if (gen !== searchGenRef.current) return;
            if (geo.location) {
              const label = geo.location.displayLabel || geo.location.formattedName;
              setSuggestions([
                {
                  placeId: geo.location.placeId,
                  label,
                  secondary: geo.location.address,
                },
              ]);
              return;
            }
          } catch (e) {
            console.warn("[LocationSearch] geocode fallback", e);
          }
        }
        if (gen !== searchGenRef.current) return;
        if (error && list.length === 0 && trimmed.length >= 2) {
          toast.error(error);
        }
        setSuggestions(list);
      } catch (e) {
        if (gen !== searchGenRef.current) return;
        console.error("[LocationSearch] failed", e);
        toast.error(t("location.searchFailed"));
      } finally {
        if (gen === searchGenRef.current) {
          setSearching(false);
        }
      }
    },
    [searchFn, geocodeFn, locale, t],
  );

  useEffect(() => {
    if (!focused) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void runSearch(query), 280);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, focused, runSearch]);

  const commitGeocode = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setResolvingId("__geocode__");
      try {
        const { location, error } = await geocodeFn({ data: { query: trimmed, locale } });
        if (error && !location) {
          toast.error(error);
          return;
        }
        if (!location) {
          toast.error(t("location.resolveFailed"));
          return;
        }
        onChange(location);
        setQuery(formatTripLocationLabel(location));
        setFocused(false);
        setSuggestions([]);
      } catch (e) {
        console.error("[LocationSearch] geocode commit failed", e);
        toast.error(t("location.resolveFailed"));
      } finally {
        setResolvingId(null);
      }
    },
    [geocodeFn, locale, onChange, t],
  );

  const handleSelect = async (item: PlaceSearchResultItem) => {
    if (item.placeId.startsWith("geocode:")) {
      await commitGeocode(item.label);
      return;
    }
    setResolvingId(item.placeId);
    try {
      const { location, error } = await unifiedResolveTripLocation(resolveFn, item.placeId, locale, {
        name: item.label,
        address: item.secondary,
      });
      if (error && !location) {
        toast.error(error);
        return;
      }
      if (!location) {
        toast.error(t("location.resolveFailed"));
        return;
      }
      onChange(location);
      setQuery(formatTripLocationLabel(location));
      setFocused(false);
      setSuggestions([]);
    } catch (e) {
      console.error("[LocationSearch] resolve failed", e);
      toast.error(t("location.resolveFailed"));
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
      } else {
        void commitGeocode(query);
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
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!e.target.value.trim()) onChange(null);
          }}
          onFocus={() => {
            if (blurCloseRef.current) clearTimeout(blurCloseRef.current);
            setFocused(true);
          }}
          onBlur={() => {
            blurCloseRef.current = setTimeout(() => setFocused(false), 180);
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

      {showResults ? (
        <PlaceSearchResultsList
          results={panelResults}
          searching={searching}
          resolvingId={resolvingId}
          onSelect={(item) => void handleSelect(item)}
          query={query}
        />
      ) : null}
    </section>
  );
}
