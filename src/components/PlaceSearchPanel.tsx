import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MapPin, Search, X } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";

export type PlaceSearchResultItem = {
  placeId: string;
  label: string;
  secondary?: string;
  photoUrl?: string | null;
  typeLabel?: string;
  distanceLabel?: string;
};

type Props = {
  open: boolean;
  query: string;
  onQueryChange: (q: string) => void;
  onClose: () => void;
  results: PlaceSearchResultItem[];
  searching: boolean;
  resolvingId: string | null;
  onSelect: (item: PlaceSearchResultItem) => void;
  placeholder?: string;
  emptyMessage?: string;
  className?: string;
};

/** 內嵌地點搜尋（不用 Drawer，避免鍵盤把輸入框頂掉） */
export function PlaceSearchPanel({
  open,
  query,
  onQueryChange,
  onClose,
  results,
  searching,
  resolvingId,
  onSelect,
  placeholder,
  emptyMessage,
  className,
}: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 80);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={cn(
        "relative z-20 mt-2 overflow-hidden rounded-2xl border border-border bg-card shadow-soft",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={placeholder ?? t("location.searchPlaceholder")}
          className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
          autoComplete="off"
          enterKeyHint="search"
        />
        {query.trim() && !searching ? (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary/80"
            aria-label="清除"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
        {searching ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {t("picker.cancel")}
        </button>
      </div>

      <ul className="max-h-[min(45vh,320px)] overflow-y-auto overscroll-contain p-1">
        {results.length === 0 && query.trim() && !searching ? (
          <li className="px-3 py-8 text-center text-sm text-muted-foreground">
            {emptyMessage ?? t("location.notFound")}
          </li>
        ) : null}
        {results.map((s) => (
          <li key={s.placeId}>
            <button
              type="button"
              disabled={resolvingId === s.placeId}
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
