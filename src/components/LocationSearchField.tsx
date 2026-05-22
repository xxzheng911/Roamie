import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MapPin, Search, X } from "lucide-react";
import { RoamiePickerSheet } from "@/components/pickers/RoamiePickerSheet";
import { searchTripLocations, resolveTripLocation } from "@/lib/location.functions";
import { formatTripLocationLabel } from "@/lib/location/format";
import type { LocationSuggestion, TripLocation } from "@/lib/location/types";
import { toast } from "sonner";
import { useI18n } from "@/hooks/use-i18n";

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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchFn = useServerFn(searchTripLocations);
  const resolveFn = useServerFn(resolveTripLocation);

  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (trimmed.length < 1) {
        setSuggestions([]);
        return;
      }
      setSearching(true);
      try {
        const { suggestions: list, error } = await searchFn({
          data: { query: trimmed, locale },
        });
        if (error) {
          toast.error(error);
          setSuggestions([]);
          return;
        }
        setSuggestions(list);
      } catch (e) {
        console.error("[LocationSearch] failed", e);
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
    debounceRef.current = setTimeout(() => runSearch(query), 280);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, runSearch]);

  const handleOpen = () => {
    if (disabled) return;
    setQuery(value ? formatTripLocationLabel(value) : "");
    setSuggestions([]);
    setOpen(true);
  };

  const handleSelect = async (item: LocationSuggestion) => {
    setResolvingId(item.placeId);
    try {
      const { location, error } = await resolveFn({ data: { placeId: item.placeId } });
      if (error || !location) {
        toast.error(error ?? t("location.resolveFailed"));
        return;
      }
      onChange(location);
      setOpen(false);
    } catch (e) {
      console.error("[LocationSearch] resolve failed", e);
      toast.error(t("location.resolveFailed"));
    } finally {
      setResolvingId(null);
    }
  };

  const display = value ? formatTripLocationLabel(value) : "";

  return (
    <section>
      <label className="text-sm font-medium">
        {label}
        {required ? " *" : ""}
      </label>
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        className="mt-2 flex w-full items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-left text-[15px] transition focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
      >
        <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className={display ? "text-foreground" : "text-muted-foreground"}>
          {display || placeholder}
        </span>
      </button>

      <RoamiePickerSheet
        open={open}
        onOpenChange={setOpen}
        hideFooter
        onConfirm={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      >
        <div className="space-y-3 pb-4">
          <div className="-mx-5 min-w-0 overflow-x-hidden">
            <div
              className="box-border mx-4 flex min-w-0 max-w-none items-center gap-2 rounded-full border border-border bg-card py-3 pl-4 pr-3 shadow-soft"
              style={{ width: "calc(100% - 32px)" }}
            >
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("location.searchPlaceholder")}
                className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
                autoComplete="off"
                autoFocus
                enterKeyHint="search"
              />
              {query.trim() && !searching ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary/80"
                  aria-label="清除搜尋"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
              {searching ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
              ) : null}
            </div>
          </div>

          <ul className="max-h-[min(50vh,360px)] space-y-1 overflow-y-auto">
            {suggestions.length === 0 && query.trim() && !searching ? (
              <li className="px-2 py-6 text-center text-sm text-muted-foreground">{t("location.notFound")}</li>
            ) : null}
            {suggestions.map((s) => (
              <li key={s.placeId}>
                <button
                  type="button"
                  disabled={resolvingId === s.placeId}
                  onClick={() => handleSelect(s)}
                  className="flex w-full items-start gap-2 rounded-xl px-3 py-3 text-left transition hover:bg-secondary/80 active:bg-secondary disabled:opacity-60"
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-clay" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium leading-snug">{s.label}</span>
                    {s.secondary ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground">{s.secondary}</span>
                    ) : null}
                  </span>
                  {resolvingId === s.placeId ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </RoamiePickerSheet>
    </section>
  );
}
