import { Navigation, Search } from "lucide-react";

type Props = {
  query: string;
  onQueryChange: (value: string) => void;
  onLocate: () => void;
  placeholder?: string;
};

/** 探索頁搜尋列 + 定位按鈕（疊在 map-stage 上，不含地圖） */
export function MapSearchBarOverlay({ query, onQueryChange, onLocate, placeholder }: Props) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-5 pt-[calc(env(safe-area-inset-top,0px)+16px)]">
      <div className="relative">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-card px-4 py-3 shadow-soft">
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
          className="pointer-events-auto absolute right-0 top-[calc(100%+0.75rem)] flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-soft"
          aria-label="我的位置"
        >
          <Navigation className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
