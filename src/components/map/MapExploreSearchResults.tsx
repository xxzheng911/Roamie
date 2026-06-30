import { Loader2, MapPin } from "lucide-react";
import type { TripStopSuggestion } from "@/lib/trip-stop-search.functions";

export type MapExploreSearchResultItem = TripStopSuggestion & {
  distanceLabel?: string;
  typeLabel?: string;
};

type Props = {
  open: boolean;
  results: MapExploreSearchResultItem[];
  searching: boolean;
  resolvingId: string | null;
  onSelect: (item: MapExploreSearchResultItem) => void;
  emptyMessage?: string;
};

/** 探索地圖搜尋：Autocomplete 結果列表（不載入遠端圖，避免 WebP / 大量 request） */
export function MapExploreSearchResults({
  open,
  results,
  searching,
  resolvingId,
  onSelect,
  emptyMessage = "找不到符合的地點",
}: Props) {
  if (!open) return null;

  return (
    <div className="pointer-events-auto mt-2 max-h-[min(42vh,300px)] overflow-hidden rounded-2xl border border-border/90 bg-card/98 shadow-soft backdrop-blur-sm">
      <ul className="max-h-[min(42vh,300px)] overflow-y-auto overscroll-contain p-1">
        {searching && results.length === 0 ? (
          <li className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            搜尋中…
          </li>
        ) : null}
        {!searching && results.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyMessage}</li>
        ) : null}
        {results.map((s) => (
          <li key={s.placeId}>
            <button
              type="button"
              disabled={resolvingId === s.placeId}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => onSelect(s)}
              className="flex w-full items-start gap-2 rounded-xl px-3 py-3 text-left transition hover:bg-secondary/80 active:bg-secondary disabled:opacity-60"
            >
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
                <MapPin className="h-4 w-4 text-clay" aria-hidden />
              </div>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium leading-snug">{s.label}</span>
                {s.secondary ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground">{s.secondary}</span>
                ) : null}
                {(s.typeLabel || s.distanceLabel) && (
                  <span className="mt-1 block text-[10px] text-muted-foreground">
                    {[s.typeLabel, s.distanceLabel].filter(Boolean).join(" · ")}
                  </span>
                )}
              </span>
              {resolvingId === s.placeId ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
