import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Search } from "lucide-react";
import { searchTripStops, resolveTripStop } from "@/lib/trip-stop-search.functions";
import {
  unifiedResolveTripStop,
  unifiedSearchTripStops,
} from "@/lib/trip-stop-search-unified";
import { PlaceSearchPanel, type PlaceSearchResultItem } from "@/components/PlaceSearchPanel";
import { pickPlaceSceneFallback } from "@/lib/place-scene-fallback";
import type { TripPlaceInput } from "@/lib/trip/trip-place-input";
import { useI18n } from "@/hooks/use-i18n";
import { toast } from "sonner";

type Props = {
  label?: string;
  onPick: (place: TripPlaceInput) => void;
  center?: { lat: number; lng: number };
  disabled?: boolean;
};

export function TripStopSearchField({ label, onPick, center, disabled }: Props) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchFn = useServerFn(searchTripStops);
  const resolveFn = useServerFn(resolveTripStop);

  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) {
        setResults([]);
        return;
      }
      setSearching(true);
      try {
        const { suggestions, error } = await unifiedSearchTripStops(
          searchFn,
          trimmed,
          locale,
          center,
        );
        if (error && suggestions.length === 0) toast.error(error);
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
    [searchFn, locale, center, t],
  );

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), 280);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, runSearch]);

  const handleSelect = async (item: PlaceSearchResultItem) => {
    setResolvingId(item.placeId);
    try {
      const { place, error } = await unifiedResolveTripStop(
        resolveFn,
        item.placeId,
        locale,
        { placeId: item.placeId, label: item.label, secondary: item.secondary },
      );
      if (!place) {
        toast.error(error ?? t("location.resolveFailed"));
        return;
      }
      onPick(place);
      setOpen(false);
      setQuery("");
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <section>
      {label ? <p className="mb-2 text-sm font-medium text-foreground/90">{label}</p> : null}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card/80 py-3 text-sm text-muted-foreground transition hover:border-foreground/25 hover:bg-card disabled:opacity-50"
      >
        {open ? <Search className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        {t("trip.addStop")}
      </button>
      <PlaceSearchPanel
        open={open}
        query={query}
        onQueryChange={setQuery}
        onClose={() => setOpen(false)}
        results={results.map((r) => ({
          ...r,
          photoUrl:
            r.photoUrl ??
            pickPlaceSceneFallback(r.label, { primaryType: r.typeLabel ?? null }),
        }))}
        searching={searching}
        resolvingId={resolvingId}
        onSelect={handleSelect}
        placeholder={t("trip.searchStopPlaceholder")}
      />
    </section>
  );
}
