import { Loader2, MapPin } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";
import type { PlaceSearchResultItem } from "@/components/PlaceSearchPanel";

type Props = {
  results: PlaceSearchResultItem[];
  searching: boolean;
  resolvingId: string | null;
  onSelect: (item: PlaceSearchResultItem) => void;
  query: string;
  emptyMessage?: string;
  className?: string;
};

/** 地點搜尋建議列表（輸入框內嵌於表單，不重複第二個搜尋列） */
export function PlaceSearchResultsList({
  results,
  searching,
  resolvingId,
  onSelect,
  query,
  emptyMessage,
  className,
}: Props) {
  const { t } = useI18n();
  const trimmed = query.trim();

  if (!trimmed && results.length === 0) return null;

  return (
    <ul
      className={cn(
        "absolute inset-x-0 top-full z-30 mt-1 max-h-[min(45vh,280px)] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card p-1 shadow-soft",
        className,
      )}
    >
      {results.length === 0 && trimmed && !searching ? (
        <li className="px-3 py-6 text-center text-sm text-muted-foreground">
          {emptyMessage ?? t("location.notFound")}
        </li>
      ) : null}
      {results.map((s) => (
        <li key={s.placeId}>
          <button
            type="button"
            disabled={resolvingId === s.placeId}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(s)}
            className="flex w-full items-start gap-2 rounded-xl px-3 py-3 text-left transition hover:bg-secondary/80 active:bg-secondary disabled:opacity-60"
          >
            {s.photoUrl ? (
              <img
                src={s.photoUrl}
                alt=""
                className="mt-0.5 h-10 w-10 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-clay" />
            )}
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
  );
}
