import { Navigation, Search } from "lucide-react";

type Props = {
  query: string;
  onQueryChange: (value: string) => void;
  onLocate: () => void;
  placeholder?: string;
};

/** 探索頁搜尋列 + 定位（貼近安全區下緣，避免與 _app main 雙重 padding） */
export function MapSearchBarOverlay({ query, onQueryChange, onLocate, placeholder }: Props) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-4 pt-[calc(var(--safe-area-top)+0.5rem)]">
      <div className="pointer-events-auto flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-border/90 bg-card/95 px-4 py-2.5 shadow-soft backdrop-blur-sm">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={placeholder ?? "想去哪裡走走？"}
            className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
            autoComplete="off"
          />
        </div>
        <button
          type="button"
          onClick={onLocate}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/90 bg-card/95 shadow-soft backdrop-blur-sm"
          aria-label="我的位置"
        >
          <Navigation className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
